import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { validateUser } from '../services/ldap.js';
import { prisma } from '../prisma/client.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { sAMAccountName, password } = req.body;
    
    if (!sAMAccountName || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const userData = await validateUser(sAMAccountName, password);
    if (!userData) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    let user = await prisma.user.findUnique({ 
      where: { samAccountName: userData.sAMAccountName } 
    });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          samAccountName: userData.sAMAccountName,
          fullName: userData.fullName,
          role: 'CONFERENTE',
        },
      });
    }

    const token = jwt.sign(
      { sub: user.samAccountName, role: user.role, fullName: user.fullName },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        samAccountName: user.samAccountName,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    if (err?.message === "Falha na autenticação LDAP") {
      return res
        .status(503)
        .json({ error: "Serviço de autenticação indisponível" });
    }
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

export default router;