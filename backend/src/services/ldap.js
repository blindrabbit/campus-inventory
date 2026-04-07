import ActiveDirectory from "activedirectory2";

const config = {
  url: process.env.LDAP_URL,
  baseDN: process.env.LDAP_BASE_DN,
  username: process.env.LDAP_BIND_USER, // opcional: conta de serviço para busca
  password: process.env.LDAP_BIND_PASS,
};

const ad = new ActiveDirectory(config);

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

export const validateUser = async (sAMAccountName, password) => {
  return new Promise((resolve, reject) => {
    authenticateWithFallback(sAMAccountName, password)
      .then((auth) => {
        if (!auth) {
          return resolve(null);
        }

        // Buscar dados do usuário
        ad.findUser(sAMAccountName, (err, user) => {
          if (err || !user) {
            return resolve({ sAMAccountName, fullName: sAMAccountName });
          }
          return resolve({
            sAMAccountName: user.sAMAccountName,
            fullName: user.displayName || user.cn || sAMAccountName,
            email: user.mail,
          });
        });
      })
      .catch((err) => {
        console.error("LDAP Error:", err);
        reject(new Error("Falha na autenticação LDAP"));
      });
  });
};