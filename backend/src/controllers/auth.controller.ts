import {Request, Response} from "express";

export function register(req: Request, res: Response) {
    res.json({
        message: "Register successful",
    })
}

export function login(req: Request, res: Response) {
    res.json({
        message: "Login successful",
    })
}