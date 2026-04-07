import ActiveDirectory from 'activedirectory2';

const config = {
  url: process.env.LDAP_URL,
  baseDN: process.env.LDAP_BASE_DN,
  username: process.env.LDAP_BIND_USER, // opcional: conta de serviço para busca
  password: process.env.LDAP_BIND_PASS,
};

const ad = new ActiveDirectory(config);

export const validateUser = async (sAMAccountName, password) => {
  return new Promise((resolve, reject) => {
    ad.authenticate(`${sAMAccountName}@${process.env.LDAP_DOMAIN}`, password, (err, auth) => {
      if (err) {
        console.error('LDAP Error:', err);
        return reject(new Error('Falha na autenticação LDAP'));
      }
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
    });
  });
};