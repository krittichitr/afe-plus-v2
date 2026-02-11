import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'
import Link from 'next/link'

import { GoogleMap, MarkerF, useLoadScript, InfoWindow, Circle, DirectionsRenderer } from '@react-google-maps/api';
import Spinner from 'react-bootstrap/Spinner';
import { encrypt } from '@/utils/helpers'

// --- Constants & Icons ---
const CONTAINER_STYLE = { width: '100vw', height: '100vh' };
const PATIENT_ICON_FG = {
    url: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
    scaledSize: { width: 44, height: 44 },
};
const PATIENT_ICON_BG = {
    path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z",
    fillColor: "white",
    fillOpacity: 1,
    strokeColor: "white",
    strokeWeight: 4,
    scale: 1.2,
};
const MY_LOC_ICON_OPT = {
    path: typeof google !== "undefined" ? google.maps.SymbolPath.FORWARD_CLOSED_ARROW : 1,
    scale: 6,
    fillColor: "#4285F4", // Blue arrow
    fillOpacity: 1,
    strokeColor: "white",
    strokeWeight: 2,
    rotation: 0
};

interface DataUserState {
    isLogin: boolean;
    userData: any | null
    takecareData: any | null
}

const Location = () => {
    const router = useRouter();
    const { isLoaded } = useLoadScript({
        googleMapsApiKey: process.env.GoogleMapsApiKey as string
    });

    // --- State ---
    const [mapRef, setMapRef] = useState<google.maps.Map | null>(null);
    const [isLoading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ show: false, message: '' });

    // Data
    const [dataUser, setDataUser] = useState<DataUserState>({ isLogin: false, userData: null, takecareData: null });
    const [safezonePos, setSafezonePos] = useState({ lat: 0, lng: 0 }); // Was 'origin'
    const [patientPos, setPatientPos] = useState({ lat: 0, lng: 0 });   // Was 'destination'
    const [myPos, setMyPos] = useState<google.maps.LatLngLiteral | null>(null);
    
    // UI/Map State
    const [heading, setHeading] = useState<number>(0);
    const [padding, setPadding] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
    const [range1, setRange1] = useState(10);
    const [range2, setRange2] = useState(20);
    
    // Routing
    const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
    const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
    const lastRouteTime = useRef<number>(0);

    const [infoWindowData, setInfoWindowData] = useState({ id: 0, address: '', show: false });

    // --- Effects ---

    // --- Helpers ---

    const onGetLocation = async (safezoneData: any, takecareData: any, userData: any) => {
        try {
            const resLocation = await axios.get(`${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${takecareData.takecare_id}&users_id=${userData.users_id}&safezone_id=${safezoneData.safezone_id}&location_id=${router.query.idlocation}`);
            if (resLocation.data?.data) {
                const data = resLocation.data?.data;
                setPatientPos({
                    lat: Number(data.locat_latitude),
                    lng: Number(data.locat_longitude),
                });
            } else {
                // Fallback to Safezone center if no location
                setPatientPos({
                    lat: Number(safezoneData.safez_latitude),
                    lng: Number(safezoneData.safez_longitude),
                });
            }
            setLoading(false);
        } catch (error) {
            console.error("Location error:", error);
            setLoading(false);
        }
    }

    const onGetSafezone = async (idSafezone: string, takecareData: any, userData: any) => {
        try {
            const resSafezone = await axios.get(`${process.env.WEB_DOMAIN}/api/setting/getSafezone?takecare_id=${takecareData.takecare_id}&users_id=${userData.users_id}&id=${idSafezone}`);
            if (resSafezone.data?.data) {
                const data = resSafezone.data?.data;
                setSafezonePos({
                    lat: Number(data.safez_latitude),
                    lng: Number(data.safez_longitude),
                });
                setRange1(data.safez_radiuslv1);
                setRange2(data.safez_radiuslv2);
                
                // Also get initial location to be sure
                onGetLocation(data, takecareData, userData);
            }
        } catch (error) {
            console.error("Safezone error:", error);
            setLoading(false);
        }
    }

    const alertModal = () => {
        setAlert({ show: true, message: 'ระบบไม่สามารถดึงข้อมูลของท่านได้ กรุณาลองใหม่อีกครั้ง' });
        setDataUser({ isLogin: false, userData: null, takecareData: null });
        setLoading(false);
    }

    const onGetUserData = useCallback(async (auToken: string) => {
        try {
            const responseUser = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUser/${auToken}`);
            if (responseUser.data?.data) {
                const encodedUsersId = encrypt(responseUser.data?.data.users_id.toString());
                const responseTakecareperson = await axios.get(`${process.env.WEB_DOMAIN}/api/user/getUserTakecareperson/${encodedUsersId}`);
                const data = responseTakecareperson.data?.data;
                
                if (data) {
                    setDataUser({ isLogin: true, userData: responseUser.data?.data, takecareData: data });
                    // Note: onGetSafezone is defined above, but we need to ensure it's accessible. 
                    // Since it's inside the component, it is. But for useCallback dependency, 
                    // we might get a warning if we don't include it, but let's stick to simple fix first.
                    onGetSafezone(router.query.idsafezone as string, data, responseUser.data?.data);
                } else {
                    alertModal();
                }
            } else {
                alertModal();
            }
        } catch (error) {
            console.error("Auth error:", error);
            alertModal();
        }
    }, [router.query.idsafezone]); // Add dep

    // --- Effects ---

    // 1. Calculate Padding (Bottom Center logic)
    useEffect(() => {
        if (typeof window !== "undefined") {
            const topPad = window.innerHeight * 0.55; 
            setPadding({ top: topPad, bottom: 150, left: 0, right: 0 });
        }
    }, []);

    // 2. Compass Heading
    useEffect(() => {
        const handleOrientation = (event: DeviceOrientationEvent) => {
            // @ts-ignore
            if (event.webkitCompassHeading) {
                // @ts-ignore
                setHeading(event.webkitCompassHeading);
            } else if (event.alpha) {
                setHeading(360 - event.alpha); 
            }
        };
        if (typeof window !== "undefined" && window.DeviceOrientationEvent) {
            window.addEventListener("deviceorientation", handleOrientation as any, true);
        }
        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("deviceorientation", handleOrientation as any);
            }
        };
    }, []);

    // 3. User Location (GPS) - Follow Me
    useEffect(() => {
        if (!navigator.geolocation) return;
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, heading: gpsHeading } = position.coords;
                const newPos = { lat: latitude, lng: longitude };
                setMyPos(newPos);

                if (gpsHeading !== null && !isNaN(gpsHeading) && position.coords.speed && position.coords.speed > 1) {
                    setHeading(gpsHeading);
                }

                // Follow Mode: Pan map to user
                if (mapRef) {
                    mapRef.panTo(newPos);
                }
            },
            (error) => console.error("Error getting location:", error),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        return () => navigator.geolocation.clearWatch(watchId);
    }, [mapRef]);

    // 4. API Polling (Patient Location)
    useEffect(() => {
        if (!dataUser?.takecareData?.userData?.origin?.lat && !dataUser.isLogin) return; 
        
        const fetchLocation = async () => {
            try {
                 const url = `${process.env.WEB_DOMAIN}/api/location/getLocation?takecare_id=${dataUser.takecareData.takecare_id}&users_id=${dataUser.userData.users_id}`;
                const resLocation = await axios.get(url);

                if (resLocation.data?.data) {
                    const data = resLocation.data.data;
                    setPatientPos({
                        lat: Number(data.locat_latitude),
                        lng: Number(data.locat_longitude),
                    });
                }
            } catch (err) {
                console.log("realtime location error", err);
            }
        };

        // Initial fetch
        if (dataUser.userData) fetchLocation();

        const interval = setInterval(fetchLocation, 3000);
        return () => clearInterval(interval);
    }, [dataUser]);

    // 5. Auth & Initial Data Load
    useEffect(() => {
        if (!router.isReady) return;

        const auToken = router.query.auToken;
        if (auToken && isLoaded) {
            onGetUserData(auToken as string);
        } else if (isLoaded && !auToken) {
            setLoading(false);
            setAlert({ show: true, message: "ไม่พบข้อมูลการเข้าสู่ระบบ (auToken Missing)" });
        }
    }, [router.query.auToken, isLoaded, router.isReady, onGetUserData]);

    const handleEmergencyNav = () => {
        const url = `https://www.google.com/maps/dir/?api=1&destination=${patientPos.lat},${patientPos.lng}`;
        window.open(url, "_blank");
    };

    const onLoad = useCallback((mapInstance: google.maps.Map) => {
        setMapRef(mapInstance);
    }, []);

    const handleMarkerClick = (id: number, address: string) => {
        setInfoWindowData({ id, address, show: true });
    };

    // Center Logic: Prioritize User, then Patient, then Safezone
    const center = useMemo(() => {
        if (myPos) return myPos;
        if (patientPos.lat !== 0) return patientPos;
        return safezonePos;
    }, [myPos, patientPos, safezonePos]);


    if (!isLoaded) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
                <Spinner animation="border" variant="primary" />
            </div>
        );
    }

    return (
        <div className="relative h-screen w-full bg-gray-100 overflow-hidden font-sans" style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
             <div className="absolute inset-0 z-0">
                <GoogleMap
                    mapContainerStyle={CONTAINER_STYLE}
                    center={center}
                    zoom={18}
                    onLoad={onLoad}
                    options={{
                        disableDefaultUI: true, // Clean UI
                        zoomControl: false,
                        heading: heading, // Dynamic Heading
                        tilt: 45, // 3D Perspective
                        padding: padding // Offset for bottom sheet
                    }}
                >
                    {/* 1. My Location (Arrow) */}
                    {myPos && (
                        <MarkerF 
                            position={myPos} 
                            icon={{ ...MY_LOC_ICON_OPT as any, rotation: heading }} 
                            zIndex={2} 
                        />
                    )}

                    {/* 2. Patient Location (Pin + Shadow) */}
                    {patientPos.lat !== 0 && (
                        <>
                            <MarkerF position={patientPos} icon={PATIENT_ICON_BG as any} zIndex={1} />
                            <MarkerF 
                                position={patientPos} 
                                icon={PATIENT_ICON_FG as any} 
                                zIndex={2} 
                                onClick={() => handleMarkerClick(1, 'ผู้มีภาวะพึ่งพิง')}
                            >
                                {infoWindowData.show && (
                                    <InfoWindow
                                        onCloseClick={() => setInfoWindowData({ id: 0, address: '', show: false })}
                                    >
                                        <div className="bg-white p-2 rounded">
                                            <h3 className="text-lg font-bold">{infoWindowData.address}</h3>
                                            {routeInfo && (
                                                <p className="text-sm text-gray-600">
                                                    ห่าง: {routeInfo.distance} ({routeInfo.duration})
                                                </p>
                                            )}
                                        </div>
                                    </InfoWindow>
                                )}
                            </MarkerF>
                        </>
                    )}

                    {/* 3. Safezone Circles */}
                    {safezonePos.lat !== 0 && (
                        <MarkerF
                            position={safezonePos}
                            icon={{
                                url: 'https://maps.google.com/mapfiles/kml/pal2/icon10.png',
                                scaledSize: new window.google.maps.Size(35, 35),
                            }}
                        >
                             <>
                                <Circle
                                    center={safezonePos}
                                    radius={range1}
                                    options={{ fillColor: "#F2BE22", strokeColor: "#F2BE22", fillOpacity: 0.2 }}
                                />
                                <Circle
                                    center={safezonePos}
                                    radius={range2}
                                    options={{ fillColor: "#F24C3D", strokeColor: "#F24C3D", fillOpacity: 0.1 }}
                                />
                            </>
                        </MarkerF>
                    )}

                     {/* 4. Directions Route */}
                     {directions && (
                        <DirectionsRenderer
                            directions={directions}
                            options={{
                                suppressMarkers: true,
                                preserveViewport: true, // Don't auto-zoom, let "Follow Me" handle it
                                polylineOptions: { strokeColor: "#2563EB", strokeWeight: 6, strokeOpacity: 0.8 },
                            }}
                        />
                    )}

                </GoogleMap>
             </div>

              {/* Bottom Sheet UI */}
            <div className="absolute bottom-0 left-0 w-full z-30 pointer-events-none">
                <div className="container mx-auto max-w-lg pointer-events-auto">
                    <div className="bg-white rounded-t-3xl shadow-[0_-5px_30px_rgba(0,0,0,0.15)] p-6 pb-10 animate-slide-up">
                        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>

                        <div className="space-y-3">
                            {/* 1. In-App Navigation (Demo Style) */}
                            <Link 
                                href={`/navigation?idlocation=${router.query.idlocation || ''}&users_id=${dataUser.userData?.users_id || ''}&takecare_id=${dataUser.takecareData?.takecare_id || ''}&auToken=${router.query.auToken || ''}`} 
                                className="block w-full text-decoration-none"
                            >
                                <button className="w-full bg-[#0F5338] hover:bg-[#0A3D28] text-white py-4 px-6 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-between group border-0">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                                        </div>
                                        <div className="text-left">
                                            <p className="text-sm font-medium text-green-100 mb-0">โหมดนำทาง (In-App)</p>
                                            <p className="text-xl font-bold leading-none mb-0">เริ่มนำทาง</p>
                                        </div>
                                    </div>
                                    <svg className="w-6 h-6 text-white/70 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                                </button>
                            </Link>
                            
                            {/* 2. External Map */}
                            <button 
                                onClick={handleEmergencyNav}
                                className="w-full bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-3 px-6 rounded-xl border border-gray-200 transition-all flex items-center justify-center gap-2"
                            >
                                <span>เปิดด้วย Google Maps</span>
                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Loading Overlay */}
            {isLoading && (
                 <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                    <Spinner animation="border" variant="primary" />
                 </div>
            )}
        </div>
    )
}

export default Location