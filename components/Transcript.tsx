import React, { useEffect, useRef } from 'react';
import { MessageLog } from '../types';
import { FileText } from 'lucide-react';

interface TranscriptProps {
  logs: MessageLog[];
}

const Transcript: React.FC<TranscriptProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex-1 w-full max-w-2xl overflow-y-auto no-scrollbar p-4 space-y-4 mask-image-gradient">
      {logs.length === 0 && (
        <div className="text-center text-cyan-800 italic mt-10 opacity-50">
          Awaiting initialization...
        </div>
      )}
      {logs.map((log) => (
        <div
          key={log.id}
          className={`flex flex-col ${
            log.sender === 'user' ? 'items-end text-right' : 'items-start text-left'
          }`}
        >
          <span className="text-[10px] uppercase tracking-widest text-cyan-700 mb-1">
            {log.sender === 'user' ? 'Operator' : 'J.A.R.V.I.S.'} // {log.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second: '2-digit'})}
          </span>
          
          {log.isReport ? (
            <div className="w-full max-w-sm bg-cyan-950/80 border border-cyan-500/50 rounded-lg p-4 shadow-[0_0_20px_rgba(6,182,212,0.15)] backdrop-blur-md">
              <div className="flex items-center gap-2 border-b border-cyan-800/50 pb-2 mb-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-cyan-300 uppercase tracking-widest">Analysis Report</span>
              </div>
              <div className="text-cyan-100 text-sm whitespace-pre-wrap font-mono leading-relaxed">
                {log.text}
              </div>
            </div>
          ) : (
            <div
              className={`px-4 py-2 rounded-lg backdrop-blur-sm border max-w-xs sm:max-w-md ${
                log.sender === 'user'
                  ? 'bg-cyan-900/20 border-cyan-800/50 text-cyan-300'
                  : 'bg-cyan-500/10 border-cyan-400/30 text-cyan-100 shadow-[0_0_15px_rgba(34,211,238,0.1)]'
              }`}
            >
              {log.text}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

export default Transcript;