import type { NextApiRequest, NextApiResponse } from "next";

// Mock destination — ประตูหน้า ม.นเรศวร ห่างจาก CSIT ประมาณ 800 เมตร
const BASE_LAT = 16.7490;
const BASE_LNG = 100.1920;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    // จำลองให้ปลายทางขยับ ±10 เมตร เหมือนคนเดินไปมา
    const jitterLat = (Math.random() - 0.5) * 0.0002;
    const jitterLng = (Math.random() - 0.5) * 0.0002;

    res.status(200).json({
        message: "success",
        data: {
            locat_latitude: String(BASE_LAT + jitterLat),
            locat_longitude: String(BASE_LNG + jitterLng),
        },
    });
}
