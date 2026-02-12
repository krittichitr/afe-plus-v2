import React, { useState } from 'react';

interface MapLayerControlProps {
  mapType: string;
  setMapType: (type: string) => void;
}

const MapLayerControl: React.FC<MapLayerControlProps> = ({ mapType, setMapType }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:bg-gray-50 transition-all active:scale-95 border-0 text-gray-700 z-40"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 17L3 10L12 3L21 10L12 17Z" stroke="#1F2937" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 14L12 21L21 14" stroke="#1F2937" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsOpen(false)}>
           <div 
             className="bg-white w-[85%] max-w-[320px] rounded-2xl p-5 shadow-2xl animate-zoom-in relative"
             onClick={(e) => e.stopPropagation()}
           >
              <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-gray-700 m-0">ประเภทแผนที่</h3>
                  <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                     </svg>
                  </button>
               </div>

               <div className="flex justify-around gap-6 px-2">
                  {/* Default */}
                  <button 
                     onClick={() => { setMapType('roadmap'); setIsOpen(false); }}
                     className="flex flex-col items-center gap-3 group"
                  >
                     <div className={`w-24 h-24 rounded-2xl overflow-hidden transition-all ${mapType === 'roadmap' ? 'border-[3px] border-[#008ba3] shadow-md p-1' : 'border-[3px] border-transparent p-1'}`}>
                        <div className="w-full h-full rounded-xl overflow-hidden relative bg-[#AEE2FF]">
                           {/* Simplified Map Illustration */}
                           <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                               <path d="M0 0 L50 0 L100 0 L100 100 L0 100 Z" fill="#b9e6fc" />
                               <path d="M100 0 L100 60 C80 50 60 70 40 60 C20 50 0 80 0 100 L0 0 Z" fill="#cbf3d2" />
                               <path d="M0 80 Q20 40 50 60 T100 50" stroke="white" strokeWidth="4" fill="none" />
                               <path d="M40 100 L60 0" stroke="#fca5a5" strokeWidth="6" opacity="0.6" />
                           </svg>
                           {/* Inner Map Detail (SVG simulation) */}
                           <div className="absolute inset-0">
                              <svg viewBox="0 0 100 100" className="w-full h-full">
                                  <path d="M0 0 H40 V100 H0 Z" fill="#86efac" opacity="0.3"/> 
                                  <path d="M50 0 L100 100" stroke="#fcd34d" strokeWidth="8"/>
                              </svg>
                           </div>
                        </div>
                     </div>
                     <span className={`text-base font-bold ${mapType === 'roadmap' ? 'text-[#008ba3]' : 'text-gray-500'}`}>ค่าเริ่มต้น</span>
                  </button>

                  {/* Satellite */}
                  <button 
                     onClick={() => { setMapType('hybrid'); setIsOpen(false); }}
                     className="flex flex-col items-center gap-3 group"
                  >
                     <div className={`w-24 h-24 rounded-2xl overflow-hidden transition-all ${mapType === 'hybrid' ? 'border-[3px] border-[#008ba3] shadow-md p-1' : 'border-[3px] border-transparent p-1'}`}>
                        <div className="w-full h-full rounded-xl overflow-hidden relative bg-gray-700">
                           {/* Simplified Satellite Illustration */}
                           <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                               <rect width="100" height="100" fill="#5F6F65"/>
                               <path d="M0 30 L100 60" stroke="#9CA3AF" strokeWidth="8" />
                               <path d="M60 0 L40 100" stroke="#9CA3AF" strokeWidth="8" />
                               <path d="M0 0 L100 100" stroke="#D1D5DB" strokeWidth="2" opacity="0.5" />
                               <circle cx="30" cy="70" r="10" fill="#374151" opacity="0.6" />
                               <circle cx="80" cy="20" r="15" fill="#374151" opacity="0.6" />
                           </svg>
                        </div>
                     </div>
                     <span className={`text-base font-bold ${mapType === 'hybrid' ? 'text-[#008ba3]' : 'text-gray-500'}`}>ดาวเทียม</span>
                  </button>
               </div>
           </div>
        </div>
      )}
    </>
  );
};

export default MapLayerControl;
