"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { GoogleMap, DirectionsRenderer } from "@react-google-maps/api";
import { useGoogleMaps } from "@/providers/GoogleMapsProvider";
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";

const MAP_CONTAINER_STYLE = { width: "100%", height: "100dvh" };

// --- Math Helpers ---
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const lerpAngle = (a: number, b: number, t: number) => {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Map Google maneuver string → type/modifier for icon
const parseGoogleManeuver = (maneuver: string) => {
  const m = (maneuver || "").toLowerCase();
  let modifier = "";
  if (m.includes("left")) modifier = "left";
  else if (m.includes("right")) modifier = "right";
  if (m.includes("uturn") || m.includes("u-turn")) modifier = "uturn";
  return { type: m, modifier };
};

const getManeuverIcon = (type: string, modifier: string) => {
  const cls = "w-[44px] h-[44px] text-white";
  if (modifier?.includes("left")) {
    return (<svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l-6-6 6-6" /><path d="M3 12h10a4 4 0 0 1 4 4v2" /></svg>);
  }
  if (modifier?.includes("right")) {
    return (<svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l6-6-6-6" /><path d="M21 12H11a4 4 0 0 0-4 4v2" /></svg>);
  }
  if (modifier?.includes("uturn") || type?.includes("u-turn")) {
    return (<svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14l-4-4 4-4" /><path d="M5 10h11a4 4 0 0 1 0 8h-1" /></svg>);
  }
  return (<svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V4" /><path d="M5 11l7-7 7 7" /></svg>);
};

// =============================================================================
export default function NavigationPage() {
  const router = useRouter();
  const { isLoaded } = useGoogleMaps();
  const mapRef = useRef<google.maps.Map | null>(null);

  // UI State
  const [isMapReady, setIsMapReady] = useState(false);
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
  const [mapStyle, setMapStyle] = useState("roadmap");
  const [isLayerModalOpen, setIsLayerModalOpen] = useState(false);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

  // Voice Refs
  const isMutedRef = useRef(false);
  const lastSpokenRef = useRef({ id: "", phase: 99 });

  // Refs
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const patientMarkerRef = useRef<google.maps.Marker | null>(null);
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
    return () => {
      isMountedRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      userMarkerRef.current?.setMap(null);
      patientMarkerRef.current?.setMap(null);
    };
  }, []);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Apply map style changes
  useEffect(() => {
    if (mapRef.current) mapRef.current.setMapTypeId(mapStyle);
  }, [mapStyle]);

  const speak = useCallback((text: string) => {
    if (isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "th-TH";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  }, []);

  const onLoad = useCallback((m: google.maps.Map) => {
    mapRef.current = m;
    m.setCenter({ lat: 16.8398, lng: 100.2654 });
    m.setZoom(19);
    setIsMapReady(true);
  }, []);

  // --- DeviceOrientation ---
  useEffect(() => {
    const handleOrientation = (e: any) => {
      if (speedRef.current < 2) {
        if (e.webkitCompassHeading !== undefined) headingRef.current = e.webkitCompassHeading;
        else if (e.alpha !== null) headingRef.current = (360 - e.alpha) % 360;
      }
    };
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, []);

  // --- Camera Loop 60fps (smooth marker + camera) ---
  useEffect(() => {
    if (!isMapReady) return;

    const tick = () => {
      if (!mapRef.current) { animFrameRef.current = requestAnimationFrame(tick); return; }

      smoothHeadingRef.current = lerpAngle(smoothHeadingRef.current, headingRef.current, 0.08);

      // Smooth user marker position (ไหลลื่นเหมือนลอยน้ำ)
      if (userPosRef.current) {
        if (!smoothUserPosRef.current) {
          smoothUserPosRef.current = { ...userPosRef.current };
        } else {
          smoothUserPosRef.current.lat = lerp(smoothUserPosRef.current.lat, userPosRef.current.lat, 0.04);
          smoothUserPosRef.current.lng = lerp(smoothUserPosRef.current.lng, userPosRef.current.lng, 0.04);
        }
        userMarkerRef.current?.setPosition(smoothUserPosRef.current);
        if (userMarkerRef.current) {
          const icon = userMarkerRef.current.getIcon() as google.maps.Symbol;
          if (icon) userMarkerRef.current.setIcon({ ...icon, rotation: smoothHeadingRef.current });
        }
      }

      // Smooth patient marker position
      if (patientPosRef.current) {
        if (!smoothPatientPosRef.current) {
          smoothPatientPosRef.current = { ...patientPosRef.current };
        } else {
          smoothPatientPosRef.current.lat = lerp(smoothPatientPosRef.current.lat, patientPosRef.current.lat, 0.02);
          smoothPatientPosRef.current.lng = lerp(smoothPatientPosRef.current.lng, patientPosRef.current.lng, 0.02);
        }
        patientMarkerRef.current?.setPosition(smoothPatientPosRef.current);
      }

      // Camera follow
      if (!isUserPanning && smoothUserPosRef.current && window.google?.maps?.geometry) {
        const center = window.google.maps.geometry.spherical.computeOffset(
          new google.maps.LatLng(smoothUserPosRef.current.lat, smoothUserPosRef.current.lng),
          50, smoothHeadingRef.current
        );
        if (center && isFinite(center.lat()) && isFinite(center.lng())) {
          try { mapRef.current.moveCamera({ center, heading: smoothHeadingRef.current, tilt: 45, zoom: 19 }); } catch (e) { }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isMapReady, isUserPanning]);

  // --- Fetch Route (Google Directions Service) ---
  const fetchRoute = useCallback((
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    force = false
  ) => {
    if (!isLoaded) return;
    if (!force && lastRouteFetchUserPosRef.current && lastRouteFetchPatientPosRef.current) {
      const userMoved = haversineDistance(lastRouteFetchUserPosRef.current.lat, lastRouteFetchUserPosRef.current.lng, start.lat, start.lng);
      const patientMoved = haversineDistance(lastRouteFetchPatientPosRef.current.lat, lastRouteFetchPatientPosRef.current.lng, end.lat, end.lng);
      if (userMoved < 15 && patientMoved < 15) return;
    }

    const ds = new google.maps.DirectionsService();
    ds.route(
      { origin: start, destination: end, travelMode: google.maps.TravelMode.DRIVING, region: "TH" },
      (res, status) => {
        if (status !== "OK" || !res || !isMountedRef.current) return;
        setDirections(res);
        const leg = res.routes[0].legs[0];

        const distValue = leg.distance?.value || 0;
        const distKm = distValue >= 1000 ? `${(distValue / 1000).toFixed(1)} กม.` : `${Math.round(distValue)} ม.`;
        const durMin = Math.ceil((leg.duration?.value || 0) / 60);
        const arrival = new Date(Date.now() + (leg.duration?.value || 0) * 1000)
          .toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

        setTotalDistance(leg.distance?.text || distKm);
        setDurationMin(String(durMin));
        setArrivalTime(arrival);

        if (leg.steps?.length > 0) {
          const currentStep = leg.steps[0];
          const nextStep = leg.steps[1];
          const activeStep = nextStep || currentStep;
          const distReal = currentStep.distance?.value || 0;

          const stepDistText = distReal >= 1000
            ? `${(distReal / 1000).toFixed(1)} กม.`
            : `${Math.round(distReal)} ม.`;

          const { type, modifier } = parseGoogleManeuver(activeStep.maneuver || "");
          const cleanInstruction = (activeStep.instructions || "").replace(/<[^>]+>/g, "");
          let bannerText = cleanInstruction || "มุ่งตรงไป";
          if (nextStep && distReal > 50) bannerText = `อีก ${stepDistText} ${cleanInstruction}`;

          setStepDistance(stepDistText);
          setInstruction(bannerText);
          setManeuverType(type);
          setManeuverModifier(modifier);

          // Voice Logic (phase system: 2km → 500m → 100m)
          const turnId = activeStep.maneuver || cleanInstruction || "end";
          if (turnId !== lastSpokenRef.current.id) {
            lastSpokenRef.current.id = turnId;
            let initialPhase = 4;
            if (distReal <= 100) initialPhase = 0;
            else if (distReal <= 500) initialPhase = 1;
            else if (distReal <= 2000) initialPhase = 2;
            else initialPhase = 3;
            lastSpokenRef.current.phase = initialPhase;
            speak(bannerText.replace("กม.", "กิโลเมตร").replace("ม.", "เมตร"));
          } else {
            let phase = lastSpokenRef.current.phase;
            let shouldSpeak = false, prefix = "";
            if (distReal <= 100 && phase > 0) { phase = 0; shouldSpeak = true; }
            else if (distReal <= 500 && phase > 1) { prefix = "อีก 500 เมตร"; phase = 1; shouldSpeak = true; }
            else if (distReal <= 2000 && phase > 2) { prefix = "อีก 2 กิโลเมตร"; phase = 2; shouldSpeak = true; }
            if (shouldSpeak) {
              lastSpokenRef.current.phase = phase;
              const msg = prefix ? `${prefix} ${cleanInstruction}` : (cleanInstruction || "ตรงไป");
              speak(msg.replace("กม.", "กิโลเมตร").replace("ม.", "เมตร"));
            }
          }
        }

        lastRouteFetchUserPosRef.current = { ...start };
        lastRouteFetchPatientPosRef.current = { ...end };
      }
    );
  }, [isLoaded, speak]);

  // --- GPS Tracking ---
  useEffect(() => {
    if (!isMapReady || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;
        const spd = speed ?? 0;
        speedRef.current = spd;
        if (isMountedRef.current) { setSpeedKmh(Math.round(spd * 3.6)); setHasLocation(true); }

        const newPos = { lat: latitude, lng: longitude };
        userPosRef.current = newPos;
        if (heading !== null && spd >= 2) headingRef.current = heading;

        // User marker — สร้างครั้งแรกครั้งเดียว camera loop จะ handle position
        if (!userMarkerRef.current && mapRef.current) {
          userMarkerRef.current = new google.maps.Marker({
            map: mapRef.current,
            position: newPos,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 8, fillColor: "#4285F4", fillOpacity: 1,
              strokeColor: "white", strokeWeight: 2.5,
              rotation: smoothHeadingRef.current,
            },
            zIndex: 100, optimized: true,
          });
        }

        if (patientPosRef.current) fetchRoute(newPos, patientPosRef.current);
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isMapReady, fetchRoute]);

  // --- Poll Patient (API จริงของโปรเจค) ---
  const fetchPatient = useCallback(async () => {
    try {
      const { users_id, takecare_id, idlocation } = router.query;
      if (!users_id || !takecare_id) return;

      const url = `${process.env.NEXT_PUBLIC_WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&location_id=${idlocation || ''}`;
      const res = await axios.get(url);
      if (!res.data?.data || !isMountedRef.current) return;

      const newPos = { lat: Number(res.data.data.locat_latitude), lng: Number(res.data.data.locat_longitude) };
      if (isNaN(newPos.lat) || isNaN(newPos.lng)) return;

      if (patientPosRef.current) {
        const dist = haversineDistance(patientPosRef.current.lat, patientPosRef.current.lng, newPos.lat, newPos.lng);
        if (dist < 15) return;
      }

      patientPosRef.current = newPos;
      if (!mapRef.current) return;

      if (!patientMarkerRef.current) {
        patientMarkerRef.current = new google.maps.Marker({
          map: mapRef.current,
          position: newPos,
          icon: {
            url: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            scaledSize: new google.maps.Size(44, 44),
            anchor: new google.maps.Point(22, 44),
          },
          zIndex: 90,
        });
      }

      if (userPosRef.current) fetchRoute(userPosRef.current, newPos);
    } catch (err) {
      console.error("Patient fetch error:", err);
    }
  }, [fetchRoute, router.query]);

  useEffect(() => {
    if (router.isReady) fetchPatient();
    const interval = setInterval(() => { if (router.isReady) fetchPatient(); }, 3000);
    return () => clearInterval(interval);
  }, [fetchPatient, router.isReady]);

  const handleRecenter = () => {
    setIsUserPanning(true);
    if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
    if (mapRef.current && userPosRef.current && window.google?.maps?.geometry) {
      const center = window.google.maps.geometry.spherical.computeOffset(
        new google.maps.LatLng(userPosRef.current.lat, userPosRef.current.lng),
        50, smoothHeadingRef.current
      );
      try { mapRef.current.moveCamera({ center, zoom: 19, heading: smoothHeadingRef.current, tilt: 45 }); } catch (e) { }
      panTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setIsUserPanning(false);
      }, 800);
    }
  };

  // Loading state
  if (!isLoaded) return (
    <div className="h-[100dvh] bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p>กำลังโหลดแผนที่...</p>
      </div>
    </div>
  );

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-black select-none font-sans">
      {/* Map — ครอบ div เพื่อจับ touch/pinch ทุกชนิด */}
      <div
        onTouchStart={() => { setIsUserPanning(true); if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current); }}
        onTouchEnd={() => { if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current); panTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setIsUserPanning(false); }, 5000); }}
        onMouseDown={() => { setIsUserPanning(true); if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current); }}
        onMouseUp={() => { if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current); panTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setIsUserPanning(false); }, 5000); }}
      >
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          onLoad={onLoad}
          options={{ disableDefaultUI: true, mapTypeId: mapStyle, gestureHandling: "greedy" }}
        >
          {directions && (
            <DirectionsRenderer directions={directions} options={{ suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: "#4285F4", strokeWeight: 10, strokeOpacity: 0.9 } }} />
          )}
        </GoogleMap>
      </div>

      {/* ===== TOP BANNER ===== */}
      <div className="absolute top-0 left-0 right-0 z-20 px-3 pt-3">
        <div className="bg-[#0F5338] rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 min-h-[88px]">
          <div className="shrink-0 flex flex-col items-center gap-1 w-14">
            {getManeuverIcon(maneuverType, maneuverModifier)}
            <span className="text-white font-extrabold text-sm leading-none">{stepDistance}</span>
          </div>
          <div className="w-px h-12 bg-white/25 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-[22px] leading-tight">
              {!isMapReady ? "กำลังโหลด..." : !hasLocation ? "กำลังหาตำแหน่ง..." : instruction}
            </p>
          </div>
        </div>
      </div>

      {/* ===== RIGHT BUTTONS ===== */}
      <div className="absolute right-3 z-20 flex flex-col gap-3" style={{ top: "160px" }}>
        {/* ปุ่มเลเยอร์ */}
        <button onClick={() => setIsLayerModalOpen(true)} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform">
          <svg className="w-6 h-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 12 12 17 22 12" />
            <polyline points="2 17 12 22 22 17" />
          </svg>
        </button>
        {/* เสียง */}
        <button onClick={() => setIsMuted(!isMuted)} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform">
          {isMuted ? (
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" /><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>
      </div>

      {/* ===== LAYER MODAL ===== */}
      {isLayerModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsLayerModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[80%] max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-900">ประเภทแผนที่</h3>
              <button onClick={() => setIsLayerModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex justify-center gap-6">
              <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => { setMapStyle("roadmap"); setIsLayerModalOpen(false); }}>
                <div className={`w-[84px] h-[84px] rounded-xl overflow-hidden border-2 transition-colors ${mapStyle === "roadmap" ? "border-[#4285F4] shadow-md" : "border-gray-200 group-hover:border-gray-300"}`}>
                  <svg viewBox="0 0 84 84" className="w-full h-full">
                    <rect width="84" height="84" fill="#e8f0e8" />
                    <path d="M0 42 Q20 30 42 45 T84 38" stroke="#b0c4b0" strokeWidth="8" fill="none" opacity="0.5" />
                    <path d="M10 0 L10 84" stroke="#fff" strokeWidth="3" />
                    <path d="M40 0 L40 84" stroke="#fff" strokeWidth="2" />
                    <path d="M0 25 L84 25" stroke="#fff" strokeWidth="2" />
                    <path d="M0 60 L84 60" stroke="#fff" strokeWidth="3" />
                    <path d="M20 0 Q35 42 50 84" stroke="#90b8db" strokeWidth="4" fill="none" />
                    <rect x="55" y="10" width="20" height="30" rx="2" fill="#d4d4d4" opacity="0.4" />
                  </svg>
                </div>
                <span className={`text-sm font-bold ${mapStyle === "roadmap" ? "text-[#4285F4]" : "text-gray-500"}`}>ค่าเริ่มต้น</span>
              </div>
              <div className="flex flex-col items-center gap-2 cursor-pointer group" onClick={() => { setMapStyle("hybrid"); setIsLayerModalOpen(false); }}>
                <div className={`w-[84px] h-[84px] rounded-xl overflow-hidden border-2 transition-colors ${mapStyle === "hybrid" ? "border-[#4285F4] shadow-md" : "border-gray-200 group-hover:border-gray-300"}`}>
                  <svg viewBox="0 0 84 84" className="w-full h-full">
                    <rect width="84" height="84" fill="#3a5a3a" />
                    <rect x="0" y="0" width="42" height="42" fill="#4a6a4a" />
                    <rect x="42" y="42" width="42" height="42" fill="#4a6a4a" />
                    <path d="M10 0 L10 84" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
                    <path d="M40 0 L40 84" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                    <path d="M0 25 L84 25" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
                    <path d="M0 60 L84 60" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
                    <path d="M20 0 Q35 42 50 84" stroke="#5588bb" strokeWidth="3" fill="none" />
                    <rect x="50" y="5" width="25" height="35" rx="2" fill="#2a4a2a" opacity="0.5" />
                  </svg>
                </div>
                <span className={`text-sm font-bold ${mapStyle === "hybrid" ? "text-[#4285F4]" : "text-gray-500"}`}>ดาวเทียม</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== SPEED ===== */}
      <div className="absolute z-20 left-3" style={{ bottom: "148px" }}>
        <div className="w-16 h-16 bg-white rounded-full shadow-lg flex flex-col items-center justify-center border-2 border-gray-100">
          <span className="text-[26px] font-extrabold text-gray-900 leading-none">{hasLocation ? speedKmh : "0"}</span>
          <span className="text-[11px] font-semibold text-gray-500 leading-none mt-0.5">km/h</span>
        </div>
      </div>

      {/* ===== RECENTER — อยู่ซ้ายบนของ speed ===== */}
      {isUserPanning && (
        <div className="absolute z-20 left-3" style={{ bottom: "224px" }}>
          <button onClick={handleRecenter} className="bg-[#4285F4] text-white px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 font-bold text-sm active:scale-95 transition-transform">
            <svg className="w-4 h-4 rotate-45" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
            ปรับจุดกลาง
          </button>
        </div>
      )}

      {/* ===== BOTTOM SHEET ===== */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-white rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pt-3 pb-8 px-5">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-3" />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-[42px] font-extrabold text-[#188038] leading-none">{durationMin}</span>
              <span className="text-[22px] font-bold text-[#188038] ml-1">นาที</span>
              <svg className="w-5 h-5 text-gray-700 ml-1 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <p className="text-gray-500 text-base font-medium mt-1 flex items-center gap-2">
              <span>{totalDistance}</span>
              <span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />
              <span>{arrivalTime} น.</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/">
              <button className="bg-[#EA4335] text-white font-bold text-lg h-12 px-7 rounded-full shadow-md active:scale-95 transition-all">
                ออก
              </button>
            </Link>
          </div>
        </div>
      </div>

    </div>
  );
}