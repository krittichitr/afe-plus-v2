import type { NextApiRequest, NextApiResponse } from "next";

// Mock destination: จุดหน้า ม.นเรศวร + jitter เล็กน้อยจำลองการเคลื่อนที่
const BASE_LAT = 16.7490;
const BASE_LNG = 100.1920;

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    const jitter = () => (Math.random() - 0.5) * 0.0004; // ~22m radius

    res.status(200).json({
        latitude: BASE_LAT + jitter(),
        longitude: BASE_LNG + jitter(),
    });
}
