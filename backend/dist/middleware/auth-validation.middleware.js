import { formatAuthValidationErrors } from "../schemas/auth.schema.js";
export function validateAuthBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json(formatAuthValidationErrors(result.error));
            return;
        }
        req.body = result.data;
        next();
    };
}
