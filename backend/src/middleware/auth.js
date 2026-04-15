import jwt from 'jsonwebtoken';

 export const verifyJWT = (req, res, next) => {
   // Try Authorization header first, fallback to query param (for SSE/EventSource)
   let token = req.headers.authorization?.split(" ")[1];
   if (!token && req.query?.token) {
     token = req.query.token;
   }

   console.log("[Auth Middleware] verifyJWT check:", {
     path: req.path,
     hasAuthHeader: !!req.headers.authorization,
     hasQueryToken: !!req.query?.token,
     tokenLength: token ? token.length : 0,
   });

   if (!token) {
     console.log("[Auth Middleware] No token provided, returning 401");
     return res.status(401).json({ error: "Token não fornecido" });
   }

   try {
     const decoded = jwt.verify(token, process.env.JWT_SECRET);
     req.user = decoded;
     console.log("[Auth Middleware] Token verified successfully:", {
       userId: decoded.sub,
       role: decoded.role,
     });
     next();
   } catch (err) {
     console.log("[Auth Middleware] Token verification failed:", err.message);
     return res.status(401).json({ error: "Token inválido ou expirado" });
   }
 };

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
  };
};