import { Router } from 'express';
import { verifyJWT, requireRole } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = Router();

router.get('/active', verifyJWT, async (req, res) => {
  try {
    const spaces = await prisma.space.findMany({
      where: { isActive: true, isFinalized: false },
      include: { _count: { select: { items: true } } },
      orderBy: { name: 'asc' }
    });

    const formatted = spaces.map(s => ({
      id: s.id,
      name: s.name,
      responsible: s.responsible,
      itemCount: s._count.items,
      isFinalized: s.isFinalized
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching spaces:', err);
    res.status(500).json({ error: 'Erro ao carregar espaços' });
  }
});

router.post('/:id/finalize', verifyJWT, requireRole('ADMIN', 'CONFERENTE'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.space.update({
      where: { id },
      data: { isFinalized: true }
    });
    res.json({ success: true, message: 'Espaço finalizado' });
  } catch (err) {
    console.error('Error finalizing space:', err);
    res.status(500).json({ error: 'Erro ao finalizar espaço' });
  }
});

export default router;