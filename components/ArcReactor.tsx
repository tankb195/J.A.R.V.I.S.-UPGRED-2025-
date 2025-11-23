import React from 'react';

interface ArcReactorProps {
  active: boolean;
  speaking: boolean;
  volumeLevel?: number; // 0 to 1
}

const ArcReactor: React.FC<ArcReactorProps> = ({ active, speaking, volumeLevel = 1 }) => {
  // Calculate dynamic styles based on state
  const eyeOpacity = active ? 0.9 + (speaking ? 0.1 : 0) : 0.1;
  const eyeGlow = active ? `drop-shadow(0 0 ${10 + (volumeLevel * 10)}px #22d3ee)` : 'none';
  const faceColor = active ? '#0891b2' : '#1e293b';
  const strokeColor = active ? '#06b6d4' : '#334155';
  
  return (
    <div className="relative w-64 h-80 flex items-center justify-center">
      {/* Background Glow Field */}
      <div 
        className={`absolute inset-0 bg-cyan-500/5 blur-[80px] rounded-full transition-all duration-700 ${active ? 'opacity-100 scale-110' : 'opacity-0 scale-75'}`} 
      />

      {/* Holographic HUD Rings (Behind Helmet) */}
      <div className={`absolute w-72 h-72 border border-cyan-900/30 rounded-full ${active ? 'animate-[spin_20s_linear_infinite]' : 'opacity-20'}`}></div>
      <div className={`absolute w-64 h-64 border border-dashed border-cyan-800/30 rounded-full ${active ? 'animate-[spin_15s_linear_infinite_reverse]' : 'opacity-20'}`}></div>

      <svg 
        viewBox="0 0 200 260" 
        className={`w-full h-full drop-shadow-2xl transition-all duration-500 ${speaking ? 'scale-105' : 'scale-100'}`}
        style={{ filter: active ? `drop-shadow(0 0 ${volumeLevel * 15}px rgba(6,182,212,0.3))` : 'none' }}
      >
        <defs>
          <linearGradient id="helmetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={active ? "#0e7490" : "#1e293b"} stopOpacity="0.4" />
            <stop offset="50%" stopColor={active ? "#06b6d4" : "#0f172a"} stopOpacity="0.1" />
            <stop offset="100%" stopColor={active ? "#0e7490" : "#1e293b"} stopOpacity="0.4" />
          </linearGradient>
          <clipPath id="eye-clip">
             {/* Eye shapes for clipping glow */}
             <path d="M 45,115 L 90,115 L 88,125 L 48,122 Z M 110,115 L 155,115 L 152,122 L 112,125 Z" />
          </clipPath>
        </defs>

        {/* --- HELMET GEOMETRY --- */}
        
        {/* Jaw/Chin */}
        <path 
          d="M 65,200 L 135,200 L 125,240 L 75,240 Z" 
          fill="url(#helmetGradient)" 
          stroke={strokeColor} 
          strokeWidth="2"
          className="transition-all duration-500"
        />

        {/* Main Faceplate */}
        <path 
          d="M 35,60 
             Q 100,10 165,60 
             L 175,120 
             L 165,180 
             Q 160,210 135,220 
             L 65,220 
             Q 40,210 35,180 
             L 25,120 
             Z" 
          fill="none" 
          stroke={strokeColor} 
          strokeWidth={active ? 2 : 1}
          className="transition-all duration-500"
        />
        
        {/* Inner Detail Lines (Cheekbones) */}
        <path 
          d="M 35,120 L 60,170 M 165,120 L 140,170" 
          stroke={strokeColor} 
          strokeWidth="1" 
          fill="none" 
          opacity="0.6"
        />

        {/* Forehead Details */}
        <path 
          d="M 80,50 L 85,80 L 115,80 L 120,50" 
          stroke={strokeColor} 
          strokeWidth="1" 
          fill="none" 
          opacity="0.5"
        />

        {/* EYES */}
        <g style={{ filter: eyeGlow, transition: 'all 0.3s ease' }}>
          {/* Left Eye */}
          <path 
            d="M 45,115 L 90,115 L 88,125 L 48,122 Z" 
            fill={active ? "#ccfbf1" : "#334155"} 
            fillOpacity={eyeOpacity}
          />
          {/* Right Eye */}
          <path 
            d="M 110,115 L 155,115 L 152,122 L 112,125 Z" 
            fill={active ? "#ccfbf1" : "#334155"} 
            fillOpacity={eyeOpacity}
          />
        </g>

        {/* Audio Reactive Mouth/Voice Visualizer */}
        {active && speaking && (
          <path 
            d="M 75,205 Q 100,215 125,205" 
            stroke="#22d3ee" 
            strokeWidth="2" 
            fill="none" 
            className="animate-pulse"
            style={{ opacity: volumeLevel }}
          />
        )}
      </svg>
      
      {/* Decorative Marks */}
      <div className="absolute top-0 w-1 h-8 bg-cyan-800/50"></div>
      <div className="absolute bottom-0 w-1 h-8 bg-cyan-800/50"></div>
    </div>
  );
};

export default ArcReactor;