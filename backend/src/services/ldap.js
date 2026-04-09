import ActiveDirectory from "activedirectory2";

const config = {
  url: process.env.LDAP_URL,
  baseDN: process.env.LDAP_BASE_DN,
  username: process.env.LDAP_BIND_USER, // opcional: conta de serviço para busca
  password: process.env.LDAP_BIND_PASS,
};

const ad = new ActiveDirectory(config);

const extractDomainBaseDN = (value) => {
  const dn = value?.toString().trim();
  if (!dn) return null;

  const dcParts = dn
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^DC=/i.test(part));

  return dcParts.length > 0 ? dcParts.join(",") : null;
};

const groupLookupBaseDN =
  process.env.LDAP_GROUP_BASE_DN ||
  process.env.LDAP_ADMIN_GROUP_BASE_DN ||
  extractDomainBaseDN(process.env.LDAP_BASE_DN) ||
  process.env.LDAP_BASE_DN;

const groupAd = new ActiveDirectory({
  ...config,
  baseDN: groupLookupBaseDN,
});

const isInvalidCredentialError = (err) => {
  const ldapMessage = `${err?.code || ""} ${err?.lde_message || err?.message || ""}`;
  return ldapMessage.includes("52e") || err?.name === "InvalidCredentialsError";
};

const authenticatePrincipal = (principal, password) => {
  return new Promise((resolve, reject) => {
    ad.authenticate(principal, password, (err, auth) => {
      if (err) {
        return reject(err);
      }
      resolve(Boolean(auth));
    });
  });
};

const authenticateWithFallback = async (sAMAccountName, password) => {
  const domain = process.env.LDAP_DOMAIN;
  const netbiosDomain =
    process.env.LDAP_NETBIOS_DOMAIN ||
    (domain ? domain.split(".")[0].toUpperCase() : undefined);

  const candidates = [
    sAMAccountName,
    domain ? `${sAMAccountName}@${domain}` : null,
    netbiosDomain ? `${netbiosDomain}\\${sAMAccountName}` : null,
  ].filter(Boolean);

  let lastError = null;

  for (const principal of candidates) {
    try {
      const authenticated = await authenticatePrincipal(principal, password);
      if (authenticated) {
        return true;
      }
    } catch (err) {
      if (isInvalidCredentialError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  if (lastError) {
    return false;
  }

  return false;
};

const findUserByAttribute = async (attribute, value) => {
  const term = value?.toString().trim();
  if (!term) return null;

  return new Promise((resolve) => {
    ad.find(
      {
        filter: `(${attribute}=${escapeLdapFilter(term)})`,
        includeMembership: [],
      },
      (err, result) => {
        const user = result?.users?.[0];
        if (err || !user) {
          return resolve(null);
        }

        return resolve(user);
      },
    );
  });
};

const normalizeDirectoryUser = (user, fallbackSamAccountName) => {
  if (!user) return null;

  const samAccountName = user.sAMAccountName || fallbackSamAccountName || null;
  const fullName = user.cn || user.displayName || user.name || null;

  if (!samAccountName) {
    return null;
  }

  return {
    sAMAccountName: samAccountName,
    fullName: fullName || null,
    email: user.mail || null,
    employeeID: user.employeeID || null,
    uid: user.uid || null,
  };
};

const normalizeDigits = (value) => value?.toString().replace(/\D/g, "") || "";

const DEFAULT_NATIVE_ADMIN_GROUP = "grpAR-Admins";

const getNativeAdminGroups = () => {
  const rawGroups =
    process.env.LDAP_NATIVE_ADMIN_GROUPS ||
    process.env.LDAP_NATIVE_ADMIN_GROUP ||
    DEFAULT_NATIVE_ADMIN_GROUP;

  return rawGroups
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);
};

const isUserMemberOfGroup = async (sAMAccountName, group) => {
  return new Promise((resolve) => {
    groupAd.isUserMemberOf(sAMAccountName, group, (err, isMember) => {
      if (err) {
        console.error("LDAP group membership lookup error:", err);
        return resolve(false);
      }

      return resolve(Boolean(isMember));
    });
  });
};

export const isDirectoryUserNativeAdmin = async (sAMAccountName) => {
  const normalizedSam = sAMAccountName?.toString().trim();
  if (!normalizedSam) return false;

  const groups = getNativeAdminGroups();
  if (!groups.length) return false;

  for (const group of groups) {
    const candidates = [group];
    if (!group.includes("=")) {
      candidates.push(`CN=${group}`);
    }

    for (const candidate of candidates) {
      const isMember = await isUserMemberOfGroup(normalizedSam, candidate);
      if (isMember) return true;
    }
  }

  return false;
};

const findDirectoryUserByIdentifier = async (identifier) => {
  const term = identifier?.toString().trim();
  if (!term) return null;

  return new Promise((resolve) => {
    ad.find(
      {
        filter: `(|(sAMAccountName=${escapeLdapFilter(term)})(employeeID=${escapeLdapFilter(term)})(uid=${escapeLdapFilter(term)})(cn=*${escapeLdapFilter(term)}*)(displayName=*${escapeLdapFilter(term)}*))`,
        includeMembership: ["user"],
      },
      (err, result) => {
        const user = result?.users?.[0];
        if (err || !user) {
          return resolve(null);
        }

        return resolve(user);
      },
    );
  });
};

const findDirectoryUsersByExactFilter = async (filter) => {
  return new Promise((resolve) => {
    ad.find(
      {
        filter,
        includeMembership: [],
      },
      (err, result) => {
        if (err || !result?.users) {
          return resolve([]);
        }

        return resolve(result.users);
      },
    );
  });
};

export const findUniqueDirectoryUserByEmployeeID = async (employeeID) => {
  const term = employeeID?.toString().trim();
  const normalizedTerm = normalizeDigits(term);
  if (!normalizedTerm) return null;

  try {
    const exactUsers = await findDirectoryUsersByExactFilter(
      `(|(employeeID=${escapeLdapFilter(normalizedTerm)})(sAMAccountName=${escapeLdapFilter(normalizedTerm)})(uid=${escapeLdapFilter(normalizedTerm)}))`,
    );
    const searchedUsers = await searchDirectoryUsers(normalizedTerm, 25);

    const candidates = new Map();
    for (const user of exactUsers) {
      const sam = user?.sAMAccountName?.toString().trim();
      if (sam) candidates.set(sam.toLowerCase(), user);
    }

    for (const user of searchedUsers) {
      const candidateEmployeeId = normalizeDigits(user?.employeeID);
      const candidateSam = user?.sAMAccountName?.toString().trim() || "";
      const candidateUid = user?.uid?.toString().trim() || "";
      const matchesSiape =
        candidateEmployeeId === normalizedTerm ||
        candidateSam.toLowerCase() === normalizedTerm.toLowerCase() ||
        candidateUid.toLowerCase() === normalizedTerm.toLowerCase();

      if (!matchesSiape || !user?.sAMAccountName) continue;

      candidates.set(user.sAMAccountName.toLowerCase(), user);
    }

    const matchedUsers = Array.from(candidates.values());
    if (matchedUsers.length !== 1) {
      return null;
    }

    const matched = matchedUsers[0];
    let normalizedUser = normalizeDirectoryUser(
      matched,
      matched?.sAMAccountName || normalizedTerm,
    );

    if (!normalizedUser?.fullName && normalizedUser?.sAMAccountName) {
      const detailed = await findDirectoryUserByIdentifier(
        normalizedUser.sAMAccountName,
      );
      const detailedNormalized = normalizeDirectoryUser(
        detailed,
        normalizedUser.sAMAccountName,
      );
      if (detailedNormalized) {
        normalizedUser = {
          ...normalizedUser,
          fullName: detailedNormalized.fullName || normalizedUser.fullName,
          email: detailedNormalized.email || normalizedUser.email,
          employeeID:
            detailedNormalized.employeeID || normalizedUser.employeeID,
          uid: detailedNormalized.uid || normalizedUser.uid,
        };
      }
    }

    return normalizedUser;
  } catch (error) {
    console.error("LDAP employeeID lookup error:", error);
    return null;
  }
};

const findDirectoryUser = async (identifier) => {
  const term = identifier?.toString().trim();
  if (!term) return null;

  const directUser = await findDirectoryUserByIdentifier(term);
  if (directUser) {
    return normalizeDirectoryUser(directUser, term);
  }

  const searchResults = await searchDirectoryUsers(term, 20);
  if (!searchResults.length) {
    return null;
  }

  const normalizedTerm = term.toLowerCase();

  const exactMatch = searchResults.find((user) => {
    const candidates = [
      user.sAMAccountName,
      user.employeeID,
      user.uid,
      user.email,
      user.fullName,
    ]
      .filter(Boolean)
      .map((value) => value.toString().trim().toLowerCase());

    return candidates.includes(normalizedTerm);
  });

  if (exactMatch) {
    return exactMatch;
  }

  return normalizeDirectoryUser(searchResults[0], term);
};

export const validateUser = async (sAMAccountName, password) => {
  return new Promise((resolve, reject) => {
    authenticateWithFallback(sAMAccountName, password)
      .then((auth) => {
        if (!auth) {
          return resolve(null);
        }

        findDirectoryUser(sAMAccountName)
          .then((user) => {
            if (!user) {
              return resolve({ sAMAccountName, fullName: sAMAccountName });
            }

            return resolve({
              sAMAccountName: user.sAMAccountName,
              fullName: user.fullName || null,
              email: user.email || null,
              employeeID: user.employeeID || null,
              uid: user.uid || null,
            });
          })
          .catch((err) => {
            console.error("LDAP lookup error:", err);
            return resolve({ sAMAccountName, fullName: sAMAccountName });
          });
      })
      .catch((err) => {
        console.error("LDAP Error:", err);
        reject(new Error("Falha na autenticação LDAP"));
      });
  });
};

export const resolveUserCn = async (sAMAccountName) => {
  if (!sAMAccountName) return null;

  try {
    const user = await findDirectoryUser(sAMAccountName);
    return user?.fullName?.trim() || null;
  } catch (error) {
    console.error("LDAP CN resolution error:", error);
    return null;
  }
};

function escapeLdapFilter(value = "") {
  return value
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\u0000/g, "\\00");
}

function buildUserSearchFilter(query) {
  const term = query?.toString().trim();
  if (!term) return null;

  const tokens = Array.from(
    new Set(
      term
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );

  const escapedTerms = [term, ...tokens].map(escapeLdapFilter);
  const attributes = [
    "sAMAccountName",
    "cn",
    "displayName",
    "givenName",
    "sn",
    "employeeID",
    "uid",
  ];

  const perTermFilters = escapedTerms.map(
    (escaped) =>
      `(|${attributes.map((attribute) => `(${attribute}=*${escaped}*)`).join("")})`,
  );

  return `(|${perTermFilters.join("")})`;
}

export const findDirectoryUserBySam = async (sAMAccountName) => {
  if (!sAMAccountName) return null;

  try {
    const user = await findDirectoryUserByIdentifier(sAMAccountName);
    return normalizeDirectoryUser(user, sAMAccountName);
  } catch (error) {
    console.error("LDAP directory lookup error:", error);
    return null;
  }
};

export const searchDirectoryUsers = async (query, limit = 10) => {
  const term = query?.toString().trim();
  if (!term || term.length < 2) return [];

  const filter = buildUserSearchFilter(term);
  if (!filter) return [];

  return new Promise((resolve) => {
    ad.findUsers(filter, false, (err, users) => {
      if (err || !users) {
        return resolve([]);
      }

      const mapped = users
        .map((user) => ({
          sAMAccountName: user.sAMAccountName,
          employeeID: user.employeeID || null,
          uid: user.uid || null,
          fullName:
            user.cn || user.displayName || user.name || user.givenName || null,
          email: user.mail || null,
        }))
        .filter((user) => Boolean(user.sAMAccountName));

      const dedup = new Map();
      for (const user of mapped) {
        dedup.set(user.sAMAccountName.toLowerCase(), user);
        if (dedup.size >= limit) break;
      }

      return resolve(Array.from(dedup.values()));
    });
  });
};
