"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Link from "next/link";
import axios from "axios";
import { useRouter } from "next/router";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
mapboxgl.accessToken = MAPBOX_TOKEN;

// --- Math Helpers ---
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
};

const lerpAngle = (a: number, b: number, t: number) => {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const getManeuverIcon = (type: string, modifier: string) => {
  const className = "w-[44px] h-[44px] text-white";
  if (modifier?.includes("left")) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l-6-6 6-6" /><path d="M3 12h10a4 4 0 0 1 4 4v2" />
      </svg>
    );
  }
  if (modifier?.includes("right")) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l6-6-6-6" /><path d="M21 12H11a4 4 0 0 0-4 4v2" />
      </svg>
    );
  }
  if (modifier?.includes("uturn") || type === "make a u-turn") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14l-4-4 4-4" /><path d="M5 10h11a4 4 0 0 1 0 8h-1" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V4" /><path d="M5 11l7-7 7 7" />
    </svg>
  );
};

export default function NavigationPage() {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  // UI State
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isUserPanning, setIsUserPanning] = useState(false);
  const [instruction, setInstruction] = useState("กำลังค้นหาเส้นทาง...");
  const [maneuverType, setManeuverType] = useState("straight");
  const [maneuverModifier, setManeuverModifier] = useState("");
  const [stepDistance, setStepDistance] = useState("--");
  const [totalDistance, setTotalDistance] = useState("--");
  const [durationMin, setDurationMin] = useState("--");
  const [arrivalTime, setArrivalTime] = useState("--:--");
  const [speedKmh, setSpeedKmh] = useState(0);
  const [hasLocation, setHasLocation] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/streets-v12");
  const [isLayerModalOpen, setIsLayerModalOpen] = useState(false);

  // Voice Refs
  const isMutedRef = useRef(false);
  const lastSpokenRef = useRef({ id: "", phase: 99 });

  // Refs
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const patientMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const patientPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const headingRef = useRef<number>(0);
  const smoothHeadingRef = useRef<number>(0);
  const speedRef = useRef<number>(0);

  const lastRouteFetchUserPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteFetchPatientPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const animFrameRef = useRef<number | null>(null);
  const panTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Smooth marker animation refs
  const smoothUserPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const smoothPatientPosRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const speak = useCallback((text: string) => {
    if (isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "th-TH";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  }, []);

  // --- Initialize Map ---
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [100.2654, 16.8398],
      zoom: 18,
      pitch: 60,
      bearing: 0,
      attributionControl: false,
    });

    const setupLayers = () => {
      if (!map.current) return;

      // Route border layer
      if (!map.current.getSource("route")) {
        map.current.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
        });
      }
      if (!map.current.getLayer("route-border")) {
        map.current.addLayer({
          id: "route-border",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#1565C0", "line-width": 16 },
        });
      }
      if (!map.current.getLayer("route-fill")) {
        map.current.addLayer({
          id: "route-fill",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#4285F4", "line-width": 11 },
        });
      }
      // re-apply route if we have one
      if (lastRouteFetchUserPosRef.current && lastRouteFetchPatientPosRef.current) {
        fetchRoute(lastRouteFetchUserPosRef.current, lastRouteFetchPatientPosRef.current, true);
      }
    };

    // Whenever style changes, we need to re-add the route source and layers
    map.current.on('style.load', setupLayers);

    map.current.on("load", () => {
      setupLayers();
      setIsMapLoaded(true);
    });

    map.current.on("dragstart", (e: any) => {
      if (!e.originalEvent) return;
      setIsUserPanning(true);
      if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
    });

    map.current.on("dragend", (e: any) => {
      if (!e.originalEvent) return;
      panTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setIsUserPanning(false);
      }, 5000);
    });

    // จับทุก interaction ที่ user ทำเอง (pinch zoom, scroll, etc.)
    map.current.on("movestart", (e: any) => {
      // เช็คว่ามาจาก user จริงๆ ไม่ใช่จาก easeTo ของเรา
      if (e.originalEvent) {
        setIsUserPanning(true);
        if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
      }
    });
    map.current.on("moveend", (e: any) => {
      if (e.originalEvent) {
        if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
        panTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) setIsUserPanning(false);
        }, 5000);
      }
    });

    return () => {
      isMountedRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // --- Apply map style changes ---
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(mapStyle);
  }, [mapStyle]);

  // --- DeviceOrientation ---
  useEffect(() => {
    const handleOrientation = (e: any) => {
      if (speedRef.current < 2) {
        let newHeading = headingRef.current;
        if (e.webkitCompassHeading !== undefined) {
          newHeading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          newHeading = (360 - e.alpha) % 360;
        }
        // Dead zone: ไม่อัปเดตถ้าเปลี่ยนน้อยกว่า 3° กันสั่น
        let diff = newHeading - headingRef.current;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        if (Math.abs(diff) > 3) {
          headingRef.current = newHeading;
        }
      }
    };
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, []);

  // --- Camera Loop 60fps (smooth marker + camera) ---
  useEffect(() => {
    if (!isMapLoaded) return;

    const tick = () => {
      if (!map.current) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      smoothHeadingRef.current = lerpAngle(smoothHeadingRef.current, headingRef.current, 0.03);

      // Smooth user marker position (ไหลลื่นเหมือนลอยน้ำ)
      if (userPosRef.current) {
        if (!smoothUserPosRef.current) {
          smoothUserPosRef.current = { ...userPosRef.current };
        } else {
          smoothUserPosRef.current.lat = lerp(smoothUserPosRef.current.lat, userPosRef.current.lat, 0.015);
          smoothUserPosRef.current.lng = lerp(smoothUserPosRef.current.lng, userPosRef.current.lng, 0.015);
        }
        // อัปเดต marker position ทุก frame
        userMarkerRef.current?.setLngLat([smoothUserPosRef.current.lng, smoothUserPosRef.current.lat]);
        userMarkerRef.current?.setRotation(smoothHeadingRef.current);
      }

      // Smooth patient marker position
      if (patientPosRef.current) {
        if (!smoothPatientPosRef.current) {
          smoothPatientPosRef.current = { ...patientPosRef.current };
        } else {
          smoothPatientPosRef.current.lat = lerp(smoothPatientPosRef.current.lat, patientPosRef.current.lat, 0.01);
          smoothPatientPosRef.current.lng = lerp(smoothPatientPosRef.current.lng, patientPosRef.current.lng, 0.01);
        }
        patientMarkerRef.current?.setLngLat([smoothPatientPosRef.current.lng, smoothPatientPosRef.current.lat]);
      }

      // Camera follow
      if (!isUserPanning && smoothUserPosRef.current) {
        const offsetY = Math.round(window.innerHeight * 0.2);
        map.current.jumpTo({
          center: [smoothUserPosRef.current.lng, smoothUserPosRef.current.lat],
          bearing: smoothHeadingRef.current,
          pitch: 60,
          zoom: 18,
          padding: { top: 0, bottom: offsetY, left: 0, right: 0 }
        });
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isMapLoaded, isUserPanning]);

  // --- Fetch Route ---
  const fetchRoute = useCallback(async (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    force = false
  ) => {
    if (!force && lastRouteFetchUserPosRef.current && lastRouteFetchPatientPosRef.current) {
      const userMoved = haversineDistance(
        lastRouteFetchUserPosRef.current.lat, lastRouteFetchUserPosRef.current.lng,
        start.lat, start.lng
      );
      const patientMoved = haversineDistance(
        lastRouteFetchPatientPosRef.current.lat, lastRouteFetchPatientPosRef.current.lng,
        end.lat, end.lng
      );

      // ถ้าระยะห่างการขยับของทั้งคู่น้อยกว่า 15 เมตร ให้ใช้เส้นทางเดิม (ประหยัดโควต้า Mapbox API)
      if (userMoved < 15 && patientMoved < 15) return;
    }

    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}?steps=true&geometries=geojson&overview=full&language=th&access_token=${MAPBOX_TOKEN}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.routes?.length || !isMountedRef.current) return;

      const route = json.routes[0];
      const leg = route.legs[0];

      const distKm = route.distance >= 1000
        ? `${(route.distance / 1000).toFixed(1)} กม.`
        : `${Math.round(route.distance)} ม.`;
      const durMin = Math.ceil(route.duration / 60);
      const arrival = new Date(Date.now() + route.duration * 1000)
        .toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

      setTotalDistance(distKm);
      setDurationMin(String(durMin));
      setArrivalTime(arrival);

      // Step instruction
      const currentStep = leg?.steps?.[0];
      const nextStep = leg?.steps?.[1];

      if (currentStep) {
        const distReal = currentStep.distance;
        const activeStep = nextStep || currentStep;

        const stepDistText = distReal >= 1000
          ? `${(distReal / 1000).toFixed(1)} กม.`
          : `${Math.round(distReal)} ม.`;

        let bannerText = activeStep.maneuver?.instruction || "มุ่งตรงไป";
        if (nextStep && distReal > 50) {
          bannerText = `อีก ${stepDistText} ${activeStep.maneuver?.instruction || ""}`;
        }

        setStepDistance(stepDistText);
        setInstruction(bannerText);
        setManeuverType(activeStep.maneuver?.type || "");
        setManeuverModifier(activeStep.maneuver?.modifier || "");

        // Voice Logic
        const turnId = activeStep.maneuver?.location?.join(",") || activeStep.maneuver?.instruction || "end";

        if (turnId !== lastSpokenRef.current.id) {
          lastSpokenRef.current.id = turnId;

          let initialPhase = 4;
          if (distReal <= 100) initialPhase = 0;
          else if (distReal <= 500) initialPhase = 1;
          else if (distReal <= 2000) initialPhase = 2;
          else initialPhase = 3;

          lastSpokenRef.current.phase = initialPhase;

          const textToSpeak = bannerText.replace("กม.", "กิโลเมตร").replace("ม.", "เมตร");
          speak(textToSpeak);
        } else {
          let phase = lastSpokenRef.current.phase;
          let shouldSpeak = false;
          let prefix = "";

          if (distReal <= 100 && phase > 0) {
            prefix = "";
            phase = 0;
            shouldSpeak = true;
          } else if (distReal <= 500 && phase > 1) {
            prefix = "อีก 500 เมตร";
            phase = 1;
            shouldSpeak = true;
          } else if (distReal <= 2000 && phase > 2) {
            prefix = "อีก 2 กิโลเมตร";
            phase = 2;
            shouldSpeak = true;
          }

          if (shouldSpeak) {
            lastSpokenRef.current.phase = phase;
            const msg = prefix
              ? `${prefix} ${activeStep.maneuver?.instruction || ""}`
              : (activeStep.maneuver?.instruction || "ตรงไป");
            speak(msg.replace("กม.", "กิโลเมตร").replace("ม.", "เมตร"));
          }
        }
      }

      // Update route geometry
      if (map.current?.getSource("route")) {
        (map.current.getSource("route") as mapboxgl.GeoJSONSource).setData({
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        });
      }

      // Save positions so we don't fetch again unless moved > 15m
      lastRouteFetchUserPosRef.current = { ...start };
      lastRouteFetchPatientPosRef.current = { ...end };
    } catch (err) {
      console.error("Route error:", err);
    }
  }, []);

  // --- GPS Tracking ---
  useEffect(() => {
    if (!isMapLoaded || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;
        const spd = speed ?? 0;
        speedRef.current = spd;

        if (isMountedRef.current) {
          setSpeedKmh(Math.round(spd * 3.6));
          setHasLocation(true);
        }

        const newPos = { lat: latitude, lng: longitude };

        // Dead zone: ไม่อัปเดตตำแหน่งถ้าขยับน้อยกว่า 2 เมตร (กัน GPS jitter)
        // แต่ยังอัปเดต heading, สร้าง marker, และเรียก fetchRoute ได้
        const posChanged = !userPosRef.current ||
          haversineDistance(userPosRef.current.lat, userPosRef.current.lng, newPos.lat, newPos.lng) >= 2;

        if (posChanged) {
          userPosRef.current = newPos;
        }

        if (heading !== null && spd >= 2) {
          headingRef.current = heading;
        }

        // User marker — สร้างครั้งแรกครั้งเดียว camera loop จะ handle position
        if (!userMarkerRef.current && map.current) {
          const wrapper = document.createElement("div");
          wrapper.style.cssText = `
            background: white;
            border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
            padding: 12px 14px 10px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            display: flex; align-items: center; justify-content: center;
          `;
          wrapper.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#4285F4">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          `;
          userMarkerRef.current = new mapboxgl.Marker({
            element: wrapper,
            rotationAlignment: "map",
            pitchAlignment: "map",
          }).setLngLat([longitude, latitude]).addTo(map.current);
        }

        if (patientPosRef.current && userPosRef.current) {
          fetchRoute(userPosRef.current, patientPosRef.current);
        }
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isMapLoaded, fetchRoute]);

  // --- Poll Patient ---
  const fetchPatient = useCallback(async () => {
    try {
      const { users_id, takecare_id, idlocation, idsafezone } = router.query;
      if (!users_id || !takecare_id) return;

      const url = `/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&safezone_id=${idsafezone || ""}&location_id=${idlocation || ""}`;
      const res = await axios.get(url);

      if (!res.data?.data) return;

      const data = res.data.data;
      if (!data?.locat_latitude || !data?.locat_longitude || !isMountedRef.current) return;

      const newPos = { lat: Number(data.locat_latitude), lng: Number(data.locat_longitude) };

      if (patientPosRef.current) {
        const dist = haversineDistance(
          patientPosRef.current.lat, patientPosRef.current.lng,
          newPos.lat, newPos.lng
        );
        // ขยับไม่ถึง 15 เมตร ให้หมุดเป้าหมายอยู่ที่เดิม จะได้ไม่กระตุกไปมา
        if (dist < 15) return;
      }

      patientPosRef.current = newPos;

      if (!map.current) return;

      if (!patientMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = `
          width: 40px; height: 40px;
          background: white;
          border: 3px solid #e53e3e;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 12px rgba(229,62,62,0.45);
        `;
        el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#e53e3e"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
        patientMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([newPos.lng, newPos.lat])
          .addTo(map.current);
      } else {
        patientMarkerRef.current.setLngLat([newPos.lng, newPos.lat]);
      }

      if (userPosRef.current) {
        fetchRoute(userPosRef.current, newPos);
      }
    } catch (err) {
      console.error("Patient fetch error:", err);
    }
  }, [fetchRoute]);

  useEffect(() => {
    fetchPatient();
    const interval = setInterval(fetchPatient, 5000);
    return () => clearInterval(interval);
  }, [fetchPatient]);

  const handleRecenter = () => {
    // ให้ isUserPanning ค้างไว้ตอนดึงกล้องกลับ จะได้ไม่โดน loop duration 0 ตัดจบแอนิเมชัน
    setIsUserPanning(true);
    if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
    if (map.current && userPosRef.current) {
      const offsetY = Math.round(window.innerHeight * 0.2);
      map.current.easeTo({
        center: [userPosRef.current.lng, userPosRef.current.lat],
        zoom: 18,
        bearing: smoothHeadingRef.current,
        pitch: 60,
        offset: [0, offsetY],
        duration: 800,
      });

      // กลับมา track รูปลื่น ๆ ต่อหลังจาก 800ms
      panTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setIsUserPanning(false);
      }, 800);
    }
  };

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-black select-none font-sans">
      {/* Map */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* ===== TOP BANNER ===== */}
      <div className="absolute top-0 left-0 right-0 z-20 px-3 pt-3">
        <div className="bg-[#0F5338] rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 min-h-[88px]">
          {/* ไอคอน + ระยะทาง */}
          <div className="shrink-0 flex flex-col items-center gap-1 w-14">
            {getManeuverIcon(maneuverType, maneuverModifier)}
            <span className="text-white font-extrabold text-sm leading-none">{stepDistance}</span>
          </div>

          {/* เส้นแบ่ง */}
          <div className="w-px h-12 bg-white/25 shrink-0" />

          {/* ข้อความนำทาง */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-[22px] leading-tight">
              {!isMapLoaded ? "กำลังโหลด..." : !hasLocation ? "กำลังหาตำแหน่ง..." : instruction}
            </p>
          </div>
        </div>
      </div>

      {/* ===== RIGHT BUTTONS ===== */}
      <div className="absolute right-3 z-20 flex flex-col gap-3" style={{ top: "180px" }}>
        {/* เข็มทิศ */}
        <button
          onClick={() => {
            setIsUserPanning(true);
            if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
            if (map.current) {
              map.current.easeTo({
                bearing: 0,
                pitch: 0,
                duration: 800
              });
            }
            // กลับมา track หลัง animation จบ
            panTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) setIsUserPanning(false);
            }, 900);
          }}
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg className="w-7 h-7" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="11" fill="white" stroke="#e5e7eb" strokeWidth="1" />
            <path d="M12 4L9.5 12h5L12 4Z" fill="#EA4335" />
            <path d="M12 20L14.5 12h-5L12 20Z" fill="#9ca3af" />
          </svg>
        </button>
        {/* ปุ่มเลเยอร์ */}
        <button
          onClick={() => setIsLayerModalOpen(true)}
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg className="w-6 h-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 12 12 17 22 12" />
            <polyline points="2 17 12 22 22 17" />
          </svg>
        </button>
        {/* เสียง */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        >
          {isMuted ? (
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>

      {/* ===== LAYER MODAL ===== */}
      {isLayerModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsLayerModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[85%] max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-800">ประเภทแผนที่</h3>
            </div>
            <div className="flex justify-center gap-8">
              {/* Default Street Style */}
              <div className="flex flex-col items-center gap-3 cursor-pointer group" onClick={() => { setMapStyle("mapbox://styles/mapbox/streets-v12"); setIsLayerModalOpen(false); }}>
                <div className={`w-20 h-20 bg-gray-50 rounded-2xl overflow-hidden border-[3px] transition-colors p-3 flex items-center justify-center ${mapStyle === "mapbox://styles/mapbox/streets-v12" ? "border-[#008296] bg-[#E0F7FA]" : "border-transparent"}`}>
                  <img src="https://cdn-icons-png.flaticon.com/512/854/854894.png" alt="ค่าเริ่มต้น" className="w-full h-full object-contain drop-shadow-sm opacity-80" />
                </div>
                <span className={`text-[15px] font-bold ${mapStyle === "mapbox://styles/mapbox/streets-v12" ? "text-[#008296]" : "text-gray-600"}`}>ค่าเริ่มต้น</span>
              </div>

              {/* Satellite Style */}
              <div className="flex flex-col items-center gap-3 cursor-pointer group" onClick={() => { setMapStyle("mapbox://styles/mapbox/satellite-streets-v12"); setIsLayerModalOpen(false); }}>
                <div className={`w-20 h-20 bg-gray-50 rounded-2xl overflow-hidden border-[3px] transition-colors p-3 flex items-center justify-center ${mapStyle === "mapbox://styles/mapbox/satellite-streets-v12" ? "border-[#008296] bg-[#E0F7FA]" : "border-transparent"}`}>
                  <img src="https://cdn-icons-png.flaticon.com/512/3233/3233887.png" alt="ดาวเทียม" className="w-full h-full object-contain drop-shadow-sm opacity-80" />
                </div>
                <span className={`text-[15px] font-bold ${mapStyle === "mapbox://styles/mapbox/satellite-streets-v12" ? "text-[#008296]" : "text-gray-600"}`}>ดาวเทียม</span>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* ===== RECENTER — อยู่เบื้องบน bottom sheet ซ้ายมือ ===== */}
      {isUserPanning && (
        <div className="absolute z-20 left-3" style={{ bottom: "148px" }}>
          <button
            onClick={handleRecenter}
            className="bg-[#4285F4] text-white px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 font-bold text-sm active:scale-95 transition-transform"
          >
            <svg className="w-4 h-4 rotate-45" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
            ปรับจุดกลาง
          </button>
        </div>
      )}

      {/* ===== BOTTOM SHEET ===== */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-white rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pt-3 pb-8 px-6">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between gap-3 mt-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[34px] font-extrabold text-[#188038] tracking-tight leading-none">{durationMin}</span>
              <span className="text-[20px] font-bold text-[#188038]">นาที</span>
              <svg className="w-[18px] h-[18px] text-[#3C4043] ml-0.5 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-[#5F6368] text-[15px] font-bold m-0 flex items-center gap-2.5">
              <span>{totalDistance}</span>
              <span className="w-1 h-1 rounded-full bg-[#5F6368] inline-block" />
              <span>{arrivalTime} น.</span>
            </p>
          </div>
          <div className="flex items-center">
            <Link href="/">
              <button className="bg-[#EA4335] text-white font-bold text-[17px] h-12 px-8 rounded-full shadow-sm active:scale-95 transition-all outline-none border-none">
                ออก
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}