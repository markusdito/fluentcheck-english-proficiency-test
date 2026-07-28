import { prisma } from "../config/db.js";
export function requireRole(...roles) {
    return async (req, res, next) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: "Not authenticated" });
                return;
            }
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user) {
                res.status(401).json({ error: "User not found" });
                return;
            }
            if (!roles.includes(user.role)) {
                res.status(403).json({ error: "Insufficient permissions" });
                return;
            }
            next();
        }
        catch {
            res.status(500).json({ error: "Internal server error" });
        }
    };
}
