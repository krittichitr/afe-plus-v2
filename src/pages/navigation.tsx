import React, { useEffect, useState, useCallback, useRef } from "react";
import { GoogleMap, DirectionsRenderer, MarkerF } from "@react-google-maps/api";
import { useGoogleMaps } from "@/providers/GoogleMapsProvider";
import MapLayerControl from "@/components/MapLayerControl";
import axios from 'axios';
import { useRouter } from 'next/router';

const MAP_CONTAINER_STYLE = { width: "100%", height: "100dvh" };
const INITIAL_CENTER = { lat: 13.7563, lng: 100.5018 };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

const lerp = (a: number, b: number, t: number) => {
  if (isNaN(a) || isNaN(b)) return b;
  return a + (b - a) * t;
};

const lerpAngle = (a: number, b: number, t: number) => {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
};

const getDistance = (p1: google.maps.LatLngLiteral, p2: google.maps.LatLngLiteral) => {
  const R = 6371e3;
  const φ1 = toRad(p1.lat), φ2 = toRad(p2.lat);
  const Δφ = toRad(p2.lat - p1.lat), Δλ = toRad(p2.lng - p1.lng);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getBearing = (from: google.maps.LatLngLiteral, to: google.maps.LatLngLiteral) => {
  const lat1 = toRad(from.lat), lat2 = toRad(to.lat);
  const dLon = toRad(to.lng - from.lng);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const b = toDeg(Math.atan2(y, x));
  return isNaN(b) ? 0 : (b + 360) % 360;
};

// Smooth 60fps marker animation
function useSmoothPosition(targetPos: google.maps.LatLngLiteral | null) {
  const smoothRef = useRef<google.maps.LatLngLiteral | null>(null);
  const [visual, setVisual] = useState<google.maps.LatLngLiteral | null>(null);
  const frameRef = useRef<number>(0);
  const targetRef = useRef<google.maps.LatLngLiteral | null>(null);

  useEffect(() => {
    targetRef.current = targetPos;
    if (!smoothRef.current && targetPos) {
      smoothRef.current = { ...targetPos };
      setVisual(targetPos);
      return;
    }
    const animate = () => {
      if (!smoothRef.current || !targetRef.current) return;
      smoothRef.current = {
        lat: lerp(smoothRef.current.lat, targetRef.current.lat, 0.08),
        lng: lerp(smoothRef.current.lng, targetRef.current.lng, 0.08),
      };
      setVisual({ ...smoothRef.current });
      frameRef.current = requestAnimationFrame(animate);
    };
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [targetPos]);

  return visual;
}

const getManeuverIcon = (instruction: string) => {
  const txt = instruction.toLowerCase();
  if (txt.includes("ซ้าย") || txt.includes("left"))
    return <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l-6-6 6-6" /><path d="M3 12h10a4 4 0 0 1 4 4v2" /></svg>;
  if (txt.includes("ขวา") || txt.includes("right"))
    return <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l6-6-6-6" /><path d="M21 12H11a4 4 0 0 0-4 4v2" /></svg>;
  return <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V4" /><path d="M5 11l7-7 7 7" /></svg>;
};

const NavigationMode = () => {
  const router = useRouter();
  const { isLoaded } = useGoogleMaps();
  const mapRef = useRef<google.maps.Map | null>(null);

  const [myPos, setMyPos] = useState<google.maps.LatLngLiteral | null>(null);
  const [patientPos, setPatientPos] = useState<google.maps.LatLngLiteral | null>(null);
  const [mapType, setMapType] = useState('satellite');
  const [isMuted, setIsMuted] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [hasLocation, setHasLocation] = useState(false);
  const [currentInstruction, setCurrentInstruction] = useState("กำลังค้นหาเส้นทาง...");
  const [stepDistance, setStepDistance] = useState("--");
  const [routeStats, setRouteStats] = useState<{ duration: string; distance: string } | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<google.maps.LatLngLiteral | null>(null);
  const [routeDestination, setRouteDestination] = useState<google.maps.LatLngLiteral | null>(null);

  const animatedMyPos = useSmoothPosition(myPos);
  const animatedPatientPos = useSmoothPosition(patientPos);

  const headingRef = useRef<number>(0);
  const smoothHeadingRef = useRef<number>(0);
  const speedRef = useRef<number>(0);
  const lastRawPosRef = useRef<google.maps.LatLngLiteral | null>(null);
  const lastInstructionRef = useRef<string>("");
  const panTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const onLoad = useCallback((m: google.maps.Map) => { mapRef.current = m; }, []);

  // DeviceOrientation
  useEffect(() => {
    const fn = (e: any) => {
      if (speedRef.current < 2) {
        if (e.webkitCompassHeading !== undefined) headingRef.current = e.webkitCompassHeading;
        else if (e.alpha !== null) headingRef.current = (360 - e.alpha) % 360;
      }
    };
    window.addEventListener("deviceorientation", fn, true);
    return () => window.removeEventListener("deviceorientation", fn, true);
  }, []);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;
        const newPos = { lat: latitude, lng: longitude };
        const spd = speed ?? 0;
        speedRef.current = spd;
        if (isMountedRef.current) { setSpeedKmh(Math.round(spd * 3.6)); setHasLocation(true); }
        if (heading !== null && spd >= 2) headingRef.current = heading;
        else if (lastRawPosRef.current) {
          const dist = getDistance(lastRawPosRef.current, newPos);
          if (dist > 2.0) { const c = getBearing(lastRawPosRef.current, newPos); if (!isNaN(c)) headingRef.current = c; }
        }
        setMyPos(newPos);
        lastRawPosRef.current = newPos;
        if (!routeOrigin || getDistance(routeOrigin, newPos) > 30) setRouteOrigin(newPos);
      },
      (err) => console.error("GPS:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [routeOrigin]);

  // Camera follow
  useEffect(() => {
    if (!isFollowing || !mapRef.current || !animatedMyPos || !window.google?.maps?.geometry) return;
    smoothHeadingRef.current = lerpAngle(smoothHeadingRef.current, headingRef.current, 0.1);
    const bearing = isNaN(smoothHeadingRef.current) ? 0 : smoothHeadingRef.current;
    const center = window.google.maps.geometry.spherical.computeOffset(animatedMyPos, 80, bearing);
    if (center && isFinite(center.lat()) && isFinite(center.lng())) {
      try { mapRef.current.moveCamera({ center, heading: bearing, tilt: 45, zoom: 19 }); } catch (e) { }
    }
  }, [animatedMyPos, isFollowing]);

  // Patient polling — ใช้ API จริง
  useEffect(() => {
    const fetch = async () => {
      const { users_id, takecare_id, idlocation } = router.query;
      if (!users_id || !takecare_id) return;
      try {
        const url = `${process.env.NEXT_PUBLIC_WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&location_id=${idlocation || ''}`;
        const res = await axios.get(url);
        if (res.data?.data) {
          const p = { lat: Number(res.data.data.locat_latitude), lng: Number(res.data.data.locat_longitude) };
          if (!isNaN(p.lat) && !isNaN(p.lng)) { setPatientPos(p); setRouteDestination(p); }
        }
      } catch (e) { console.error(e); }
    };
    if (router.isReady) fetch();
    const interval = setInterval(() => { if (router.isReady) fetch(); }, 3000);
    return () => clearInterval(interval);
  }, [router.isReady, router.query]);

  // Voice
  const speak = useCallback((text: string) => {
    if (isMuted || typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH';
    window.speechSynthesis.speak(u);
  }, [isMuted]);

  // Directions
  useEffect(() => {
    if (!isLoaded || !routeOrigin || !routeDestination) return;
    const ds = new google.maps.DirectionsService();
    ds.route({ origin: routeOrigin, destination: routeDestination, travelMode: google.maps.TravelMode.DRIVING }, (res, status) => {
      if (status === "OK" && res) {
        setDirections(res);
        const leg = res.routes[0].legs[0];
        setRouteStats({ distance: leg.distance?.text || "...", duration: leg.duration?.text || "..." });
        if (leg.steps?.length > 0) {
          const clean = (leg.steps[0].instructions || "").replace(/<[^>]+>/g, '');
          const dist = leg.steps[0].distance?.text || "";
          setCurrentInstruction(clean || "มุ่งตรงไป");
          setStepDistance(dist);
          if (clean !== lastInstructionRef.current) { lastInstructionRef.current = clean; speak(`อีก ${dist} ${clean}`); }
        }
      }
    });
  }, [isLoaded, routeOrigin, routeDestination, speak]);

  const handleRecenter = () => {
    setIsFollowing(true);
    if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
    if (myPos && mapRef.current) mapRef.current.moveCamera({ center: myPos, zoom: 19, heading: smoothHeadingRef.current, tilt: 45 });
  };

  const getArrivalTime = () => {
    if (!routeStats) return "--:--";
    const m = routeStats.duration.match(/(\d+)/);
    if (m) { const d = new Date(); d.setMinutes(d.getMinutes() + parseInt(m[0])); return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }); }
    return "--:--";
  };

  if (!isLoaded) return (
    <div className="h-[100dvh] bg-black text-white flex items-center justify-center">
      <div className="text-center"><div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p>กำลังโหลดแผนที่...</p></div>
    </div>
  );

  const PATIENT_ICON_FG = { url: "https://cdn-icons-png.flaticon.com/512/684/684908.png", scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 44) };
  const PATIENT_ICON_BG = { path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z", fillColor: "white", fillOpacity: 1, strokeColor: "white", strokeWeight: 4, scale: 1.2, anchor: new google.maps.Point(0, 0) };

  return (
    <div className="relative w-full h-[100dvh] bg-gray-900 overflow-hidden font-sans select-none">

      <GoogleMap mapContainerStyle={MAP_CONTAINER_STYLE} center={INITIAL_CENTER} zoom={19} onLoad={onLoad}
        onDragStart={() => { setIsFollowing(false); if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current); }}
        options={{ disableDefaultUI: true, mapTypeId: mapType, gestureHandling: "greedy" }}>

        {animatedMyPos && (
          <MarkerF position={animatedMyPos} options={{ optimized: true }}
            icon={{ path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 8, fillColor: "#4285F4", fillOpacity: 1, strokeColor: "white", strokeWeight: 2.5, rotation: smoothHeadingRef.current }}
            zIndex={100} />
        )}
        {animatedPatientPos && (<>
          <MarkerF position={animatedPatientPos} icon={PATIENT_ICON_BG as any} zIndex={90} options={{ optimized: false }} />
          <MarkerF position={animatedPatientPos} icon={PATIENT_ICON_FG as any} zIndex={91} options={{ optimized: false }} />
        </>)}
        {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: "#4285F4", strokeWeight: 10, strokeOpacity: 0.9 } }} />}
      </GoogleMap>

      {/* TOP BANNER */}
      <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3">
        <div className="bg-[#0F5338] rounded-2xl shadow-2xl px-4 py-4 flex items-center gap-3 min-h-[88px]">
          <div className="shrink-0 flex flex-col items-center gap-1 w-14">
            {getManeuverIcon(currentInstruction)}
            <span className="text-white font-extrabold text-sm leading-none">{stepDistance}</span>
          </div>
          <div className="w-px h-12 bg-white/25 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-[20px] leading-tight">
              {!hasLocation ? "กำลังหาตำแหน่ง..." : currentInstruction}
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT BUTTONS */}
      <div className="absolute right-3 z-30 flex flex-col gap-3" style={{ top: "112px" }}>
        <MapLayerControl mapType={mapType} setMapType={setMapType} />
        <button onClick={() => setIsMuted(!isMuted)} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform">
          {isMuted
            ? <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
            : <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
          }
        </button>
      </div>

      {/* SPEED */}
      <div className="absolute z-30 left-3" style={{ bottom: "148px" }}>
        <div className="w-16 h-16 bg-white rounded-full shadow-lg flex flex-col items-center justify-center border-2 border-gray-100">
          <span className="text-[26px] font-extrabold text-gray-900 leading-none">{speedKmh}</span>
          <span className="text-[11px] font-semibold text-gray-500 leading-none mt-0.5">km/h</span>
        </div>
      </div>

      {/* RECENTER */}
      {!isFollowing && (
        <div className="absolute z-30 left-3" style={{ bottom: "224px" }}>
          <button onClick={handleRecenter} className="bg-[#4285F4] text-white px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 font-bold text-sm active:scale-95 transition-transform">
            <svg className="w-4 h-4 rotate-45" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
            ปรับจุดกลาง
          </button>
        </div>
      )}

      {/* BOTTOM SHEET */}
      <div className="absolute bottom-0 left-0 w-full z-30 bg-white rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.2)] px-5 pt-3 pb-8">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-3" />
        <div className="flex items-center justify-between gap-3">
          <div>
            {routeStats ? (<>
              <div className="flex items-baseline gap-1">
                <span className="text-[42px] font-extrabold text-[#188038] leading-none">{routeStats.duration.match(/\d+/)?.[0] || "--"}</span>
                <span className="text-[22px] font-bold text-[#188038] ml-1">นาที</span>
                <svg className="w-5 h-5 text-gray-700 ml-1 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <p className="text-gray-500 text-base font-medium mt-1 flex items-center gap-2">
                <span>{routeStats.distance}</span>
                <span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />
                <span>{getArrivalTime()} น.</span>
              </p>
            </>) : <span className="text-xl font-bold text-gray-400 animate-pulse">กำลังคำนวณเส้นทาง...</span>}
          </div>
          <div className="flex items-center gap-3">
            <button className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center active:scale-95 transition-transform">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            </button>
            <button onClick={() => router.back()} className="bg-[#EA4335] text-white font-bold text-lg h-12 px-7 rounded-full shadow-md active:scale-95 transition-all">ออก</button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default NavigationMode;