import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { formatAuthValidationErrors } from "../schemas/auth.schema.js";

export function validateAuthBody<T>(schema: z.ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(formatAuthValidationErrors(result.error));
      return;
    }

    req.body = result.data;
    next();
  };
}
