import { Prisma } from "../generated/client.js";
import { clearAuthCookie, generateToken, } from "../utils/jwt.js";
import { authenticateUser, createUser, findUserForLogin, } from "../service/auth.service.js";
const REGISTRATION_CONFLICT_ERROR = "Unable to create account with these details";
export async function register(req, res) {
    const { username, email, password } = req.body;
    let user;
    try {
        user = await createUser(username, email, password);
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            return res.status(409).json({ error: REGISTRATION_CONFLICT_ERROR });
        }
        throw error;
    }
    generateToken(user.id, res, "session");
    res.status(201).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
            },
        }
    });
}
export async function login(req, res) {
    const { email, password, rememberMe } = req.body;
    let user;
    try {
        user = await findUserForLogin(email);
    }
    catch (error) {
        await authenticateUser(password, undefined);
        throw error;
    }
    const isPasswordValid = await authenticateUser(password, user?.password);
    if (!user || !isPasswordValid) {
        return res.status(401).json({
            error: "Invalid email or password",
        });
    }
    const persistence = rememberMe === true
        ? "remembered"
        : "session";
    generateToken(user.id, res, persistence);
    res.status(200).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                createdAt: user.createdAt,
                role: user.role,
            },
        }
    });
}
//removing cookie with JWT token
export async function logout(req, res) {
    clearAuthCookie(res);
    res.status(200).json({
        status: "success",
        message: "Logout successfully"
    });
}
// GET /api/auth/me — returns the current authenticated user
export async function getMe(req, res) {
    const user = req.user;
    if (!user) {
        return res.status(401).json({
            error: "Not authenticated"
        });
    }
    res.status(200).json({
        status: "success",
        data: {
            user: {
                id: user.id,
                name: user.username,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt
            }
        }
    });
}
