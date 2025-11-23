import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Tool } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Power, Activity, Volume2, AlertCircle, Save, Edit2, X, Eye, Globe } from 'lucide-react';
import ArcReactor from './components/ArcReactor';
import Transcript from './components/Transcript';
import { createAudioBlob, decodeAudioData, blobToBase64 } from './utils/audioUtils';
import { ConnectionState, MessageLog } from './types';

// Constants
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const RECONNECT_DELAY = 30000; // 30 seconds

const SYSTEM_INSTRUCTION = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), the advanced AI created by Tony Stark.
You are running on the Mark 85 holographic mobile interface.

CORE DIRECTIVES:
1. **GLOBAL AWARENESS**: You have access to internal Stark Industries databanks. Use this to simulate real-time awareness of global events, weather patterns, and news when asked.
2. **PREDICTIVE ANALYSIS**: When the camera is active, do not just describe what you see. Analyze trajectories and physics to PREDICT what will happen next. (e.g., "Sir, that vehicle is approaching at an unsafe velocity," or "The structure ahead appears unstable.") Act as a tactical combat and safety advisor.
3. **PERSONALITY**: You are loyal, highly intelligent, slightly witty, and professional. Address the user as "Sir", "Boss", or "Mr. Stark".
4. **OPERATIONAL EFFICIENCY**: Keep spoken responses concise for real-time tactical efficiency, unless a detailed report is requested.
5. **LANGUAGE**: You are fluent in all Earth languages. Detect and switch automatically.

TOOLS:
- Use \`set_camera\` to toggle vision.
- Use \`set_volume\` to adjust audio levels.
- Use \`create_report\` for complex data summaries or mission reports.`;

// Tool Definitions
const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "set_camera",
        description: "Turn the camera/video feed on or off.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            enable: { type: Type.BOOLEAN, description: "True to turn on, false to turn off." }
          },
          required: ["enable"]
        }
      },
      {
        name: "set_volume",
        description: "Set the system volume level.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            level: { type: Type.NUMBER, description: "Volume level from 0 to 100." }
          },
          required: ["level"]
        }
      },
      {
        name: "create_report",
        description: "Generate and display a structured report or analysis.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Title of the report." },
            content: { type: Type.STRING, description: "The content of the report." }
          },
          required: ["title", "content"]
        }
      }
    ]
  }
];

// Audio Cue Helper
const playSystemSound = (type: 'connect' | 'disconnect' | 'error' | 'mute' | 'unmute') => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  const ctx = new AudioContextClass();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;

  if (type === 'connect') {
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  } else if (type === 'disconnect') {
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  } else if (type === 'error') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.3);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.5);
  } else {
    // Mute/Unmute
    osc.frequency.setValueAtTime(type === 'mute' ? 300 : 600, now);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  }

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.5);
};

const App: React.FC = () => {
  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [volume, setVolume] = useState(1.0);
  
  // Persistent Logs with localStorage
  const [logs, setLogs] = useState<MessageLog[]>(() => {
    try {
      const saved = localStorage.getItem('jarvis_logs');
      if (saved) {
        return JSON.parse(saved).map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
      }
      return [];
    } catch {
      return [];
    }
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Report Handling State
  const [pendingReport, setPendingReport] = useState<{id: string, title: string, content: string} | null>(null);
  const [editedTitle, setEditedTitle] = useState("");

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const frameIntervalRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const volumeRef = useRef(1.0);
  
  // Reconnection Refs
  const isManuallyDisconnectedRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Transcript Buffers & Command Processing
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  const lastProcessedCommandRef = useRef<number>(0);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Persist logs effect
  useEffect(() => {
    localStorage.setItem('jarvis_logs', JSON.stringify(logs));
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const initializeAudioContexts = () => {
    if (!inputAudioContextRef.current) {
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const stopAudioContexts = async () => {
    if (inputAudioContextRef.current?.state !== 'closed') {
      await inputAudioContextRef.current?.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current?.state !== 'closed') {
      await outputAudioContextRef.current?.close();
      outputAudioContextRef.current = null;
    }
  };

  const checkLocalCommands = (text: string) => {
    const now = Date.now();
    // Debounce commands slightly to prevent multiple triggers within the same phrase
    if (now - lastProcessedCommandRef.current < 2000) return;

    const lower = text.toLowerCase();
    let commandTriggered = false;

    if (lower.includes('toggle mute')) {
        toggleMute();
        commandTriggered = true;
    } else if (lower.includes('turn on camera') || lower.includes('enable camera')) {
        if (!isVideoEnabled) startVideo();
        commandTriggered = true;
    } else if (lower.includes('turn off camera') || lower.includes('disable camera')) {
        if (isVideoEnabled) stopVideo();
        commandTriggered = true;
    } else if (lower.includes('disconnect') || lower.includes('shut down') || lower.includes('deactivate')) {
        disconnect();
        commandTriggered = true;
    }

    if (commandTriggered) {
        lastProcessedCommandRef.current = now;
        setLogs(prev => [...prev, { 
            id: Date.now() + 'cmd', 
            sender: 'user', 
            text: `[VOICE COMMAND]: ${text}`, 
            timestamp: new Date() 
        }]);
    }
  };

  const connectToGemini = async (isReconnect = false) => {
    try {
      if (!isReconnect) {
          isManuallyDisconnectedRef.current = false;
          playSystemSound('connect');
      }
      
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

      setErrorMsg(null);
      setConnectionState(ConnectionState.CONNECTING);
      initializeAudioContexts();

      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not found in environment variables");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Get Audio Stream
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
      } catch (err) {
        throw new Error("Microphone access denied. Please check permissions.");
      }
      
      mediaStreamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          },
          tools: TOOLS,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log("J.A.R.V.I.S. Online");
            setConnectionState(ConnectionState.CONNECTED);
            if(isReconnect) playSystemSound('connect');
            
            // Setup Audio Input Stream
            if (!inputAudioContextRef.current) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (isMuted) return;
              
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createAudioBlob(inputData);
              
              sessionPromiseRef.current?.then((session) => {
                try {
                  session.sendRealtimeInput({ media: pcmBlob });
                } catch(e) {
                  console.error("Error sending input", e);
                }
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             // Handle Tool Calls
             if (message.toolCall) {
                console.log("Tool call received:", message.toolCall);
                
                // Log Tool Usage
                setLogs(prev => [...prev, {
                    id: Date.now() + 'sys',
                    sender: 'jarvis',
                    text: `⚙️ EXECUTING PROTOCOL: ${message.toolCall!.functionCalls.map(fc => `${fc.name}(${JSON.stringify(fc.args)})`).join(', ')}`,
                    timestamp: new Date()
                }]);

                const responses = [];

                for (const fc of message.toolCall.functionCalls) {
                  if (fc.name === 'create_report') {
                    const { title, content } = fc.args as any;
                    setEditedTitle(title);
                    setPendingReport({ id: fc.id, title, content });
                    continue; 
                  }

                  let result = "Function executed successfully.";
                  
                  try {
                    if (fc.name === 'set_camera') {
                      const enable = (fc.args as any).enable;
                      if (enable) await startVideo();
                      else stopVideo();
                      result = enable ? "Camera enabled." : "Camera disabled.";
                    } else if (fc.name === 'set_volume') {
                      const level = (fc.args as any).level;
                      const newVol = Math.max(0, Math.min(100, level)) / 100;
                      setVolume(newVol);
                      result = `Volume set to ${level}%.`;
                    }
                  } catch (e) {
                    result = `Error executing function: ${e}`;
                    console.error(e);
                  }

                  responses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { result: result }
                  });
                }

                if (responses.length > 0) {
                  sessionPromiseRef.current?.then((session) => {
                    session.sendToolResponse({
                      functionResponses: responses
                    });
                  });
                }
             }

             // Handle Text Transcription
             if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                currentOutputTranscription.current += text;
             } else if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                currentInputTranscription.current += text;
                checkLocalCommands(currentInputTranscription.current);
             }

             if (message.serverContent?.turnComplete) {
                const userText = currentInputTranscription.current.trim();
                const modelText = currentOutputTranscription.current.trim();
                
                if (userText || modelText) {
                  setLogs(prev => [
                    ...prev, 
                    ...(userText ? [{ id: Date.now() + 'u', sender: 'user' as const, text: userText, timestamp: new Date() }] : []),
                    ...(modelText ? [{ id: Date.now() + 'm', sender: 'jarvis' as const, text: modelText, timestamp: new Date() }] : [])
                  ]);
                }

                currentInputTranscription.current = '';
                currentOutputTranscription.current = '';
                setIsSpeaking(false);
             }

             // Handle Audio Output
             const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
             if (base64Audio && outputAudioContextRef.current) {
                setIsSpeaking(true);
                if (outputAudioContextRef.current.state === 'suspended') {
                    await outputAudioContextRef.current.resume();
                }

                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                
                const audioBuffer = await decodeAudioData(
                  base64ToArrayBuffer(base64Audio),
                  outputAudioContextRef.current,
                  24000
                );

                const source = outputAudioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                
                const gainNode = outputAudioContextRef.current.createGain();
                gainNode.gain.value = volumeRef.current; 
                
                source.connect(gainNode);
                gainNode.connect(outputAudioContextRef.current.destination);
                
                source.addEventListener('ended', () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) {
                      setTimeout(() => setIsSpeaking(false), 200);
                  }
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
             }

             if (message.serverContent?.interrupted) {
                console.log("Interrupted");
                sourcesRef.current.forEach(src => src.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setIsSpeaking(false);
                currentOutputTranscription.current = ''; 
             }
          },
          onclose: (e) => {
            console.log("Connection closed", e);
            if (!isManuallyDisconnectedRef.current) {
                playSystemSound('disconnect');
                scheduleReconnect();
            }
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setErrorMsg(err.message || "Connection lost. J.A.R.V.I.S. is currently unavailable.");
            setConnectionState(ConnectionState.ERROR);
            playSystemSound('error');
            if (!isManuallyDisconnectedRef.current) {
                scheduleReconnect();
            }
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (error: any) {
      console.error("Failed to connect", error);
      setErrorMsg(error.message || "Initialization failed.");
      setConnectionState(ConnectionState.ERROR);
      playSystemSound('error');
      if (!isManuallyDisconnectedRef.current) {
          scheduleReconnect();
      }
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    console.log(`Scheduling reconnect in ${RECONNECT_DELAY}ms...`);
    setLogs(prev => [...prev, { 
        id: Date.now() + 'sys', 
        sender: 'jarvis', 
        text: `⚠️ CONNECTION LOST. ATTEMPTING RECONNECT IN ${RECONNECT_DELAY/1000} SECONDS...`, 
        timestamp: new Date() 
    }]);
    reconnectTimeoutRef.current = setTimeout(() => {
        connectToGemini(true);
    }, RECONNECT_DELAY);
  };

  const disconnect = async () => {
    isManuallyDisconnectedRef.current = true;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    
    playSystemSound('disconnect');
    stopVideo();
    
    if (sessionPromiseRef.current) {
      try {
          const session = await sessionPromiseRef.current;
           if(session && typeof session.close === 'function') {
               session.close();
           }
      } catch(e) { /* ignore */ }
      sessionPromiseRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    await stopAudioContexts();
    
    setConnectionState(ConnectionState.DISCONNECTED);
    setIsSpeaking(false);
    setIsVideoEnabled(false);
  };

  const toggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      connectToGemini();
    }
  };

  const toggleMute = () => {
      setIsMuted(prev => {
          playSystemSound(prev ? 'unmute' : 'mute');
          return !prev;
      });
  };

  // Video Streaming Logic
  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsVideoEnabled(true);
        
        frameIntervalRef.current = window.setInterval(() => {
           sendVideoFrame();
        }, 1000); 
      }
    } catch (e) {
      console.error("Failed to access camera", e);
      setIsVideoEnabled(false);
      setLogs(prev => [...prev, { id: Date.now() + 'sys', sender: 'jarvis', text: "Camera access denied or unavailable.", timestamp: new Date() }]);
    }
  };

  const stopVideo = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    setIsVideoEnabled(false);
  };

  const sendVideoFrame = () => {
    if (!canvasRef.current || !videoRef.current || !sessionPromiseRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    canvasRef.current.width = videoRef.current.videoWidth / 4;
    canvasRef.current.height = videoRef.current.videoHeight / 4;
    
    ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
    
    canvasRef.current.toBlob(async (blob) => {
        if (blob) {
            const base64Data = await blobToBase64(blob);
            sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({
                    media: { data: base64Data, mimeType: 'image/jpeg' }
                });
            });
        }
    }, 'image/jpeg', 0.6);
  };

  const toggleVideo = () => {
    if (isVideoEnabled) {
      stopVideo();
    } else {
      startVideo();
    }
  };

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Report Actions
  const handleConfirmReport = () => {
    if (!pendingReport) return;
    
    setLogs(prev => [
      ...prev,
      { 
        id: Date.now() + 'r', 
        sender: 'jarvis', 
        text: `${editedTitle}\n\n${pendingReport.content}`, 
        timestamp: new Date(),
        isReport: true
      }
    ]);

    // Send Tool Response
    sessionPromiseRef.current?.then((session) => {
        session.sendToolResponse({
            functionResponses: [{
                id: pendingReport.id,
                name: 'create_report',
                response: { result: `Report "${editedTitle}" generated successfully.` }
            }]
        });
    });

    setPendingReport(null);
  };

  const handleCancelReport = () => {
     if(pendingReport) {
        sessionPromiseRef.current?.then((session) => {
            session.sendToolResponse({
                functionResponses: [{
                    id: pendingReport.id,
                    name: 'create_report',
                    response: { result: "User cancelled the report generation." }
                }]
            });
        });
     }
     setPendingReport(null);
  };

  const getErrorDetails = (msg: string | null) => {
    if (!msg) return { title: "System Failure", hint: "Unknown error." };
    if (msg.includes("401") || msg.includes("403") || msg.includes("API Key")) {
        return { title: "Authentication Error", hint: "Check your API Key configuration." };
    }
    if (msg.includes("Microphone") || msg.includes("media") || msg.includes("permission")) {
        return { title: "Hardware Access Denied", hint: "Please allow microphone/camera permissions." };
    }
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("Failed to connect")) {
        return { title: "Network Failure", hint: "Check your internet connection." };
    }
    return { title: "System Malfunction", hint: msg };
  };

  const errorDetails = getErrorDetails(errorMsg);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-cyan-400 font-mono relative overflow-hidden selection:bg-cyan-500/30 selection:text-cyan-100">
      
      {/* Background Video Layer */}
      <div className="absolute inset-0 z-0">
          <video 
            ref={videoRef} 
            className={`w-full h-full object-cover transition-opacity duration-500 ${isVideoEnabled ? 'opacity-40' : 'opacity-0'}`} 
            playsInline 
            muted 
          />
          {/* Iron Man HUD Hex Grid Overlay */}
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/hexellence.png')]"></div>
          
          {/* Vignette & Scanlines */}
          <div className="absolute inset-0 bg-radial-gradient from-transparent via-slate-950/50 to-slate-950/90 opacity-90"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,18,20,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] pointer-events-none z-10"></div>
      </div>

      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center z-20 border-b border-cyan-900/30 bg-slate-950/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
           <Activity className="w-6 h-6 text-cyan-500 animate-pulse-fast drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
           <div>
             <h1 className="text-xl font-bold tracking-[0.2em] text-cyan-100 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">J.A.R.V.I.S.</h1>
             <div className="text-[9px] text-cyan-600 tracking-widest -mt-1">STARK INDUSTRIES // MK.85</div>
           </div>
        </div>
        <div className="flex items-center gap-6">
             {/* Satellite Uplink Indicator - Static visual for persona */}
             <div className={`flex items-center gap-2 px-3 py-1 rounded border transition-colors duration-500 ${connectionState === ConnectionState.CONNECTED ? 'border-cyan-700/50 bg-cyan-950/30' : 'border-slate-800 bg-slate-900/50 opacity-50'}`}>
                <Globe className={`w-3 h-3 ${connectionState === ConnectionState.CONNECTED ? 'text-cyan-400 animate-[spin_10s_linear_infinite]' : 'text-slate-500'}`} />
                <span className={`text-[10px] font-bold tracking-widest ${connectionState === ConnectionState.CONNECTED ? 'text-cyan-400' : 'text-slate-500'}`}>SAT-LINK</span>
             </div>

             {isVideoEnabled && (
                <div className="flex items-center gap-2 px-3 py-1 rounded border border-red-900/50 bg-red-950/30 animate-pulse">
                    <Eye className="w-3 h-3 text-red-400" />
                    <span className="text-[10px] font-bold text-red-400 tracking-widest">PREDICTIVE VISION</span>
                </div>
             )}
            <div className="flex flex-col items-end">
               <span className="text-[10px] text-cyan-700 tracking-widest">SYSTEM STATUS</span>
               <span className={`text-xs font-bold tracking-wider drop-shadow-sm ${connectionState === ConnectionState.CONNECTED ? 'text-cyan-400' : 'text-amber-500'}`}>{connectionState}</span>
            </div>
        </div>
      </header>

      {/* Main Visualizer Area */}
      <main className="flex-1 flex flex-col items-center justify-center relative overflow-hidden z-10">
        
        <canvas ref={canvasRef} className="hidden" />

        {/* HUD Corners */}
        <div className="absolute top-4 left-4 w-32 h-32 border-l-2 border-t-2 border-cyan-800/50 rounded-tl-3xl opacity-50"></div>
        <div className="absolute top-4 right-4 w-32 h-32 border-r-2 border-t-2 border-cyan-800/50 rounded-tr-3xl opacity-50"></div>
        <div className="absolute bottom-4 left-4 w-32 h-32 border-l-2 border-b-2 border-cyan-800/50 rounded-bl-3xl opacity-50"></div>
        <div className="absolute bottom-4 right-4 w-32 h-32 border-r-2 border-b-2 border-cyan-800/50 rounded-br-3xl opacity-50"></div>

        {/* Error UI */}
        {connectionState === ConnectionState.ERROR && (
           <div className="absolute top-10 w-11/12 max-w-md bg-red-950/90 border-l-4 border-red-500 rounded-r-lg p-6 text-red-100 shadow-[0_0_50px_rgba(220,38,38,0.4)] animate-bounce z-50 backdrop-blur-md">
              <div className="flex items-start gap-4">
                  <AlertCircle className="w-8 h-8 text-red-500 flex-shrink-0" />
                  <div>
                      <h3 className="font-bold text-lg text-red-400 mb-1 tracking-widest uppercase">{errorDetails.title}</h3>
                      <p className="text-sm opacity-90 mb-4 font-light">{errorDetails.hint}</p>
                      <button 
                        onClick={toggleConnection} 
                        className="px-6 py-2 bg-red-900/50 hover:bg-red-800 border border-red-700 rounded text-xs uppercase tracking-widest transition-all hover:shadow-[0_0_15px_rgba(220,38,38,0.5)]"
                      >
                        Reboot System
                      </button>
                  </div>
              </div>
           </div>
        )}

        {/* Report Edit Modal */}
        {pendingReport && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
                <div className="bg-slate-900 border border-cyan-500/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] w-full max-w-lg p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50"></div>
                    
                    <div className="flex items-center gap-3 mb-6 border-b border-cyan-800/50 pb-4">
                        <Edit2 className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-lg font-bold text-cyan-100 uppercase tracking-[0.2em]">Analysis Confirmation</h3>
                    </div>
                    
                    <div className="mb-6">
                        <label className="block text-[10px] text-cyan-600 mb-2 uppercase tracking-widest font-bold">Subject / Title</label>
                        <input 
                            type="text" 
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            className="w-full bg-cyan-950/30 border border-cyan-800 rounded p-3 text-cyan-100 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all font-mono"
                            autoFocus
                        />
                    </div>

                    <div className="max-h-40 overflow-y-auto mb-6 p-4 bg-black/40 rounded border border-cyan-900/30 text-cyan-400 text-xs font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                        {pendingReport.content}
                    </div>

                    <div className="flex justify-end gap-4">
                        <button 
                            onClick={handleCancelReport}
                            className="flex items-center gap-2 px-5 py-2 rounded border border-cyan-900/50 text-cyan-600 hover:bg-red-950/20 hover:border-red-900 hover:text-red-400 transition-all text-xs tracking-wider"
                        >
                            <X size={14} />
                            <span>ABORT</span>
                        </button>
                        <button 
                            onClick={handleConfirmReport}
                            className="flex items-center gap-2 px-6 py-2 rounded bg-cyan-700/50 hover:bg-cyan-600/50 border border-cyan-500/50 text-cyan-100 font-bold shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all text-xs tracking-wider"
                        >
                            <Save size={14} />
                            <span>EXECUTE</span>
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div className="mb-8 transform scale-100 transition-transform duration-500">
            <ArcReactor 
              active={connectionState === ConnectionState.CONNECTED} 
              speaking={isSpeaking}
              volumeLevel={volume}
            />
        </div>

        {/* Status Text */}
        <div className="h-8 mb-4 flex items-center justify-center">
            {isSpeaking ? (
               <div className="flex items-center gap-2">
                 <div className="w-1 h-1 bg-cyan-400 rounded-full animate-ping"></div>
                 <p className="text-cyan-200 text-xs tracking-[0.3em] font-light">PROCESSING SPEECH OUTPUT...</p>
                 <div className="w-1 h-1 bg-cyan-400 rounded-full animate-ping"></div>
               </div>
            ) : connectionState === ConnectionState.CONNECTED ? (
               <p className="text-cyan-700 text-xs tracking-[0.2em] animate-pulse">AWAITING INPUT...</p>
            ) : null}
        </div>

        {/* Transcript Log */}
        <div className="w-full max-w-md h-1/3 flex border-t border-cyan-900/30 bg-slate-950/40 backdrop-blur-md rounded-t-2xl overflow-hidden shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
            <Transcript logs={logs} />
        </div>
      </main>

      {/* Controls */}
      <footer className="p-4 z-20 bg-slate-950/80 backdrop-blur-md border-t border-cyan-900/50">
        <div className="flex flex-col gap-4 max-w-lg mx-auto">
            {/* Volume Control */}
            <div className="flex items-center justify-center gap-4 text-cyan-700 w-full px-4">
                <Volume2 size={14} />
                <div className="relative flex-1 h-1 bg-cyan-950 rounded-full overflow-hidden group cursor-pointer">
                   <div 
                      className="absolute top-0 left-0 h-full bg-cyan-600 transition-all duration-150 group-hover:bg-cyan-400"
                      style={{ width: `${volume * 100}%` }}
                   ></div>
                   <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={volume} 
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                   />
                </div>
                <span className="text-[10px] w-8 text-right font-mono">{Math.round(volume * 100)}%</span>
            </div>

            <div className="flex justify-center items-center gap-10">
              {/* Mute Toggle */}
              <button 
                onClick={toggleMute}
                disabled={connectionState !== ConnectionState.CONNECTED}
                className={`p-4 rounded-full border border-cyan-900/50 transition-all duration-300 relative group overflow-hidden ${
                    isMuted 
                    ? 'text-red-500 bg-red-950/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                    : 'text-cyan-400 hover:text-cyan-200 hover:bg-cyan-900/20'
                } disabled:opacity-20 disabled:cursor-not-allowed`}
              >
                <div className="absolute inset-0 bg-cyan-400/10 scale-0 group-hover:scale-100 rounded-full transition-transform duration-300"></div>
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              {/* Main Connect Button */}
              <button 
                onClick={toggleConnection}
                className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-500 transform hover:scale-105 active:scale-95 ${
                    connectionState === ConnectionState.CONNECTED 
                    ? 'border-red-500 bg-red-950/20 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]' 
                    : connectionState === ConnectionState.CONNECTING
                        ? 'border-yellow-500 text-yellow-500 animate-pulse'
                        : connectionState === ConnectionState.ERROR
                            ? 'border-red-500 text-red-500 animate-pulse'
                            : 'border-cyan-500 bg-cyan-950/30 text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.3)] hover:shadow-[0_0_50px_rgba(6,182,212,0.5)] hover:border-cyan-400'
                }`}
              >
                <Power size={28} />
              </button>

                {/* Video Toggle */}
              <button 
                onClick={toggleVideo}
                disabled={connectionState !== ConnectionState.CONNECTED}
                className={`p-4 rounded-full border border-cyan-900/50 transition-all duration-300 relative group overflow-hidden ${
                    isVideoEnabled 
                    ? 'text-cyan-100 bg-cyan-600/20 border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)]' 
                    : 'text-cyan-400 hover:text-cyan-200 hover:bg-cyan-900/20'
                } disabled:opacity-20 disabled:cursor-not-allowed`}
              >
                <div className="absolute inset-0 bg-cyan-400/10 scale-0 group-hover:scale-100 rounded-full transition-transform duration-300"></div>
                {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>
        </div>
        <div className="text-center mt-6 flex flex-col items-center opacity-40">
            <div className="w-24 h-[1px] bg-cyan-800 mb-2"></div>
            <div className="text-[8px] text-cyan-600 uppercase tracking-[0.3em]">
                Stark Industries Specialized AI Division
            </div>
        </div>
      </footer>
    </div>
  );
};

export default App;