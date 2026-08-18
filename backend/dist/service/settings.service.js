import { prisma } from "../config/db.js";
const APP_SETTINGS_ID = 1;
const SETTINGS_SELECT = {
    paymentEnabled: true,
    updatedAt: true,
};
export async function getAppSettings() {
    const settings = await prisma.appSettings.findUnique({
        where: { id: APP_SETTINGS_ID },
        select: SETTINGS_SELECT,
    });
    if (settings)
        return settings;
    return prisma.appSettings.upsert({
        where: { id: APP_SETTINGS_ID },
        update: {},
        create: {
            id: APP_SETTINGS_ID,
            paymentEnabled: true,
        },
        select: SETTINGS_SELECT,
    });
}
export async function updatePaymentEnabled(paymentEnabled) {
    return prisma.appSettings.upsert({
        where: { id: APP_SETTINGS_ID },
        update: { paymentEnabled },
        create: {
            id: APP_SETTINGS_ID,
            paymentEnabled,
        },
        select: SETTINGS_SELECT,
    });
}
