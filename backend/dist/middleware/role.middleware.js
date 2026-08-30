export function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        if (!roles.includes(user.role)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
        }
        next();
    };
}
