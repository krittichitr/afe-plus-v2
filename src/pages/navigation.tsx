import React, { useEffect, useState, useCallback, useRef } from "react";
import { GoogleMap, DirectionsRenderer, MarkerF } from "@react-google-maps/api";
import { useGoogleMaps } from "@/providers/GoogleMapsProvider"; 
import MapLayerControl from "@/components/MapLayerControl";
import axios from 'axios';
import { useRouter } from 'next/router';

// --- Configuration ---
const MAP_CONTAINER_STYLE = { width: "100%", height: "100dvh" };
const INITIAL_CENTER = { lat: 13.7563, lng: 100.5018 };
const POS_ANIMATION_DURATION = 1000; // ms

// --- Math Helpers ---
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

const getDistance = (p1: google.maps.LatLngLiteral, p2: google.maps.LatLngLiteral) => {
  const R = 6371e3;
  const φ1 = toRad(p1.lat);
  const φ2 = toRad(p2.lat);
  const Δφ = toRad(p2.lat - p1.lat);
  const Δλ = toRad(p2.lng - p1.lng);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Calculate Bearing (ทิศทาง) from two points (prev -> next)
const getBearing = (from: google.maps.LatLngLiteral, to: google.maps.LatLngLiteral) => {
    if (!from || !to) return 0;
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const dLon = toRad(to.lng - from.lng);
  
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    
    let brng = toDeg(Math.atan2(y, x));
    if (isNaN(brng)) return 0;
    return (brng + 360) % 360;
};

const lerp = (start: number, end: number, t: number) => {
    if (isNaN(start) || isNaN(end)) return end;
    return start * (1 - t) + end * t;
};

// --- Hooks ---
function useAnimatedPosition(targetPos: google.maps.LatLngLiteral | null) {
  const [visualPos, setVisualPos] = useState<google.maps.LatLngLiteral | null>(targetPos);
  const prevPosRef = useRef<google.maps.LatLngLiteral | null>(targetPos);
  const targetPosRef = useRef<google.maps.LatLngLiteral | null>(targetPos);
  const startTimeRef = useRef<number>(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (!targetPos) return;
    if (!prevPosRef.current) {
       prevPosRef.current = targetPos;
       targetPosRef.current = targetPos;
       setVisualPos(targetPos);
       return;
    }
    prevPosRef.current = visualPos;
    targetPosRef.current = targetPos;
    startTimeRef.current = performance.now();

    const animate = (time: number) => {
      if (!prevPosRef.current || !targetPosRef.current) return;
      const elapsed = time - startTimeRef.current;
      const progress = Math.min(elapsed / POS_ANIMATION_DURATION, 1);
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // Cubic ease out
      const t = ease(progress);

      const lat = lerp(prevPosRef.current.lat, targetPosRef.current.lat, t);
      const lng = lerp(prevPosRef.current.lng, targetPosRef.current.lng, t);

      if (!isNaN(lat) && !isNaN(lng)) {
          setVisualPos({ lat, lng });
      }

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevPosRef.current = { lat, lng };
      }
    };

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [targetPos]);

  return visualPos;
}

const NavigationMode = () => {
  const router = useRouter();
  const { isLoaded } = useGoogleMaps();
  const mapRef = useRef<google.maps.Map | null>(null);

  // -- State --
  const [myPos, setMyPos] = useState<google.maps.LatLngLiteral | null>(null); // Target GPS
  const [bearing, setBearing] = useState<number>(0); // Logical Bearing
  const [patientPos, setPatientPos] = useState<google.maps.LatLngLiteral | null>(null);
  const [mapType, setMapType] = useState('roadmap');
  const [isMuted, setIsMuted] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);

  // -- Visuals --
  // LERP Position for User
  const animatedMyPos = useAnimatedPosition(myPos); 
  // LERP Position for Patient
  const animatedPatientPos = useAnimatedPosition(patientPos);

  // -- Heading Refs --
  const headingRef = useRef<number>(0);
  const smoothHeadingRef = useRef<number>(0);
  const deviceHeadingRef = useRef<number>(0);
  const speedRef = useRef<number>(0);

  // DeviceOrientation — เข็มทิศตอนหยุดนิ่ง
  useEffect(() => {
    const handleOrientation = (e: any) => {
      if (speedRef.current < 2) {
        if (e.webkitCompassHeading !== undefined) {
          deviceHeadingRef.current = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          deviceHeadingRef.current = (360 - e.alpha) % 360;
        }
        headingRef.current = deviceHeadingRef.current;
      }
    };
    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, []);
  const [routeOrigin, setRouteOrigin] = useState<google.maps.LatLngLiteral | null>(null);
  const [routeDestination, setRouteDestination] = useState<google.maps.LatLngLiteral | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeStats, setRouteStats] = useState<{ duration: string; distance: string } | null>(null);

  // Refs
  const lastRawPosRef = useRef<google.maps.LatLngLiteral | null>(null);
  const lastBearingRef = useRef<number>(0);
  const lastInstructionRef = useRef<string>("");

  const onLoad = useCallback((mapInstance: google.maps.Map) => {
    mapRef.current = mapInstance;
  }, []);

  // -- 1. GPS LOGIC --
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;
        const newPos = { lat: latitude, lng: longitude };
        const spd = speed ?? 0;
        speedRef.current = spd;

        // ใช้ GPS heading โดยตรงเมื่อเร็วพอ
        if (heading !== null && spd >= 2) {
          headingRef.current = heading;
        }
        // เมื่อช้า ใช้ bearing คำนวณจาก 2 จุด
        else if (lastRawPosRef.current) {
          const dist = getDistance(lastRawPosRef.current, newPos);
          if (dist > 2.0) {
            const calculatedBearing = getBearing(lastRawPosRef.current, newPos);
            if (!isNaN(calculatedBearing)) {
              headingRef.current = calculatedBearing;
            }
          }
        }

        setBearing(headingRef.current);
        lastBearingRef.current = headingRef.current;
        setMyPos(newPos);
        lastRawPosRef.current = newPos;

        if (!routeOrigin || getDistance(routeOrigin, newPos) > 30) {
          setRouteOrigin(newPos);
        }
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [routeOrigin]);

  // -- 2. CAMERA & MAP CONTROL --
  useEffect(() => {
    if (!isFollowing || !mapRef.current || !animatedMyPos || !window.google) return;

    // Smooth heading ด้วย lerp ป้องกันกระตุก
    const lerpAngle = (a: number, b: number, t: number) => {
      let diff = b - a;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return a + diff * t;
    };

    smoothHeadingRef.current = lerpAngle(smoothHeadingRef.current, headingRef.current, 0.1);
    const currentBearing = isNaN(smoothHeadingRef.current) ? 0 : smoothHeadingRef.current;

    const OFFSET_METERS = 80;

    if (window.google.maps.geometry) {
      const cameraCenter = window.google.maps.geometry.spherical.computeOffset(
        animatedMyPos,
        OFFSET_METERS,
        currentBearing
      );

      if (cameraCenter && isFinite(cameraCenter.lat()) && isFinite(cameraCenter.lng())) {
        try {
          mapRef.current.moveCamera({
            center: cameraCenter,
            heading: currentBearing,
            tilt: 45,
            zoom: 19,
          });
        } catch (e) {
          console.error("Camera Move Error:", e);
        }
      }
    }
  }, [animatedMyPos, isFollowing]);

  const handleMapDrag = () => {
      // Allow user to pan away
      setIsFollowing(false);
  };

  const handleRecenter = () => {
     setIsFollowing(true);
     // Instant snap back
     if (myPos && mapRef.current) {
        // Trigger effect will handle the rest, but we can do an initial move
        // to prevent waiting for next animation frame
        mapRef.current.moveCamera({ center: myPos, zoom: 19, heading: bearing, tilt: 45 });
     }
  };

  // -- Patient Polling --
  useEffect(() => {
    const fetch = async () => {
       const { users_id, takecare_id, idlocation } = router.query;
       if (!users_id || !takecare_id) return;
       try {
           const url = `${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecare_id}&users_id=${users_id}&location_id=${idlocation || ''}`;
           const res = await axios.get(url);
           if (res.data?.data) {
                const p = { lat: Number(res.data.data.locat_latitude), lng: Number(res.data.data.locat_longitude) };
                setPatientPos(p);
                setRouteDestination(p);
           }
       } catch (err) { console.error(err); }
    };
    if (router.isReady) fetch();
    const interval = setInterval(() => { if (router.isReady) fetch(); }, 3000);
    return () => clearInterval(interval);
  }, [router.isReady, router.query]);

  // -- Voice & Routing --
  const speak = (text: string) => {
     if (isMuted || typeof window === 'undefined') return;
     window.speechSynthesis.cancel();
     const utterance = new SpeechSynthesisUtterance(text);
     utterance.lang = 'th-TH'; 
     window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (isLoaded && routeOrigin && routeDestination) {
      const ds = new google.maps.DirectionsService();
      ds.route({ origin: routeOrigin, destination: routeDestination, travelMode: google.maps.TravelMode.DRIVING }, (res, status) => {
         if (status === "OK" && res) {
            setDirections(res);
            const leg = res.routes[0].legs[0];
            setRouteStats({
               distance: leg.distance?.text || "...",
               duration: leg.duration?.text || "...",
            });
            if (leg.steps && leg.steps.length > 0) {
                const rawInstruction = leg.steps[0].instructions || "";
                const cleanInstruction = rawInstruction.replace(/<[^>]+>/g, '');
                if (cleanInstruction !== lastInstructionRef.current) {
                    lastInstructionRef.current = cleanInstruction;
                    const distCheck = leg.steps[0].distance?.text || "";
                    speak(`อีก ${distCheck} ${cleanInstruction}`);
                }
            }
         }
      });
    }
  }, [isLoaded, routeOrigin, routeDestination]);

  const getArrivalTime = () => {
     if (!routeStats) return "--:--";
     const match = routeStats.duration.match(/(\d+)/);
     if (match) {
        const d = new Date();
        d.setMinutes(d.getMinutes() + parseInt(match[0]));
        return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute:"2-digit"});
     }
     return "--:--";
  };

  if (!isLoaded) return <div className="h-[100dvh] bg-black text-white flex center items-center justify-center">Loading...</div>;

  const PATIENT_ICON_FG = {
      url: "https://cdn-icons-png.flaticon.com/512/684/684908.png", 
      scaledSize: new google.maps.Size(44, 44),
      anchor: new google.maps.Point(22, 44)
  };
  const PATIENT_ICON_BG = {
      path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z",
      fillColor: "white", fillOpacity: 1, strokeColor: "white", strokeWeight: 4, scale: 1.2, anchor: new google.maps.Point(0, 0)
  };

  return (
    <div className="relative w-full h-[100dvh] bg-gray-900 overflow-hidden font-sans">
      
      {/* --- Top Header --- */}
      <div className="absolute top-4 left-4 right-4 md:left-8 md:right-8 z-30 bg-[#0F5338] text-white p-4 rounded-xl shadow-xl flex items-center justify-between min-h-[80px]">
          <div className="flex items-start gap-3 md:gap-4">
             <div className="mt-1">
                <svg className="w-8 h-8 md:w-10 md:h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
             </div>
             <div>
                <p className="text-xl md:text-2xl font-bold leading-tight tracking-wide">มุ่งหน้าตามเส้นทาง</p>
                <p className="text-base md:text-lg text-green-100 font-medium">ระยะทาง {routeStats?.distance || '...'}</p>
             </div>
          </div>
      </div>

      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={INITIAL_CENTER} 
        zoom={19}
        onLoad={onLoad}
        onDragStart={handleMapDrag} 
        options={{ 
            disableDefaultUI: true, 
            mapTypeId: mapType, 
            gestureHandling: "greedy",
        }}
        // Note: initial tilt/heading handled by moveCamera in effect
      >
         {/* User Marker */}
         {animatedMyPos && (
            <MarkerF
               position={animatedMyPos}
               options={{ optimized: true }}
               icon={{
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 7,
                  fillColor: "#4285F4",
                  fillOpacity: 1,
                  strokeColor: "white",
                  strokeWeight: 2,
                  rotation: bearing, // Rotate arrow with bearing
               }}
               zIndex={100}
            />
         )}

          {/* Patient Marker */}
          {animatedPatientPos && (
              <>
                 <MarkerF position={animatedPatientPos} icon={PATIENT_ICON_BG as any} zIndex={90} options={{optimized:false}} />
                 <MarkerF position={animatedPatientPos} icon={PATIENT_ICON_FG as any} zIndex={91} options={{optimized:false}} />
              </>
          )}

         {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: true, polylineOptions: { strokeColor: "#4285F4", strokeWeight: 10, strokeOpacity: 0.9 }, preserveViewport: true }} />}
      </GoogleMap>

      {/* --- Controls --- */}
      <div className="absolute right-4 top-32 md:top-36 flex flex-col gap-3 md:gap-4 z-30">
          <MapLayerControl mapType={mapType} setMapType={setMapType} />
          
           {/* Mute Button */}
          <div 
             onClick={() => setIsMuted(!isMuted)}
             className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:bg-gray-50 bg-opacity-90 backdrop-blur"
          >
             {isMuted ? (
                <svg className="w-5 h-5 md:w-6 md:h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
             ) : (
                <svg className="w-5 h-5 md:w-6 md:h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
             )}
          </div>
      </div>

      {/* Recenter Button */}
      {!isFollowing && (
        <div onClick={handleRecenter} className="absolute bottom-44 md:bottom-40 left-4 z-30 bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 cursor-pointer text-blue-600 font-bold text-sm tracking-wide hover:bg-gray-50 transition-colors animate-fade-in-up">
            <svg className="w-4 h-4 transform rotate-45" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
            ปรับจุดกลาง
        </div>
      )}

      {/* --- Bottom Sheet --- */}
      <div className="absolute bottom-0 left-0 w-full z-30 bg-white rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.2)] px-6 py-6 pb-safe md:pb-10 transition-transform duration-300">
         <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4"></div>
         <div className="flex items-center justify-between">
             <div className="flex flex-col">
                {routeStats ? (
                   <>
                     <span className="text-3xl md:text-4xl font-extrabold text-[#188038] tracking-tight">{routeStats.duration}</span>
                     <div className="flex items-center gap-2 mt-1 text-gray-500 font-medium text-sm">
                        <span>{routeStats.distance}</span><span>•</span><span>{getArrivalTime()}</span>
                     </div>
                   </>
                ) : (
                   <span className="text-2xl font-bold text-gray-400 animate-pulse">Calculating...</span>
                )}
             </div>
             
             <div className="hidden sm:flex w-12 h-12 bg-gray-100 rounded-full items-center justify-center text-gray-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
             </div>
             
             <button onClick={() => router.back()} className="bg-red-600 hover:bg-red-700 text-white text-lg font-bold py-3 px-6 md:px-8 rounded-full shadow-md transition-all active:scale-95">ออก</button>
         </div>
      </div>
    </div>
  );
}

export default NavigationMode;