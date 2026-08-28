'use client';

import React, { useEffect, useRef, useState } from 'react';
import { 
  Camera, Mic, Settings, Download, RotateCcw, Play, Pause, Square, 
  Sparkles, Trash2, Video, Volume2, Monitor, RefreshCw, LayoutGrid
} from 'lucide-react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { drawBackground, drawCartoonBody, draw2DAvatar, AvatarType, BackgroundType, FaceData } from '../utils/avatarRenderer';

type AspectRatio = '9:16' | '1:1' | '16:9' | '4:3';

const ASPECT_RATIOS: Record<AspectRatio, { width: number; height: number; label: string; ratio: number }> = {
  '9:16': { width: 720, height: 1280, label: '9:16 (Portrait)', ratio: 9/16 },
  '1:1': { width: 720, height: 720, label: '1:1 (Square)', ratio: 1 },
  '16:9': { width: 1280, height: 720, label: '16:9 (Landscape)', ratio: 16/9 },
  '4:3': { width: 960, height: 720, label: '4:3 (Classic)', ratio: 4/3 },
};

export default function RecorderComponent() {
  // 1. Device and Stream States
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);

  // 2. Control States
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [avatarType, setAvatarType] = useState<AvatarType>('none');
  const [backgroundType, setBackgroundType] = useState<BackgroundType>('camera');
  
  // 3. Recording & Review States
  const [recordingState, setRecordingState] = useState<'idle' | 'countdown' | 'recording' | 'paused' | 'review'>('idle');
  const [countdown, setCountdown] = useState<number>(3);
  const [recordedUrlHD, setRecordedUrlHD] = useState<string | null>(null);
  const [recordedUrlSD, setRecordedUrlSD] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);


  // Keep a ref in sync so the animation loop can read it without triggering re-mounts
  const setRecordingStateSynced = (next: 'idle' | 'countdown' | 'recording' | 'paused' | 'review') => {
    recordingStateRef.current = next;
    setRecordingState(next);
  };
  
  // 5. Audio Visualizer State
  const [micVolume, setMicVolume] = useState<number>(0);

  // 6. Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRefHD = useRef<MediaRecorder | null>(null);
  const mediaRecorderRefSD = useRef<MediaRecorder | null>(null);
  const recordedChunksRefHD = useRef<Blob[]>([]);
  const recordedChunksRefSD = useRef<Blob[]>([]);
  const animationFrameIdRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  // Ref mirror of recordingState so the canvas loop can read it without being a dep
  const recordingStateRef = useRef<string>('idle');
  // Track last processed video timestamp to prevent MediaPipe timestamp errors
  const lastVideoTimeRef = useRef<number>(-1);

  // 7. Initialize Face Landmarker Hook
  const { landmarkerRef, isLoading: isLandmarkerLoading, error: landmarkerError, ready: isLandmarkerReady } = useFaceLandmarker();

  // LERP Smoothing Pipeline Refs
  const smoothedCxRef = useRef<number | null>(null);
  const smoothedCyRef = useRef<number | null>(null);
  const smoothedScaleRef = useRef<number | null>(null);
  const smoothedRotationRef = useRef<number | null>(null);
  const smoothedMarRef = useRef<number | null>(null);

  // Preload graphics assets and patch console.error to suppress WASM errors on mount
  useEffect(() => {
    // Suppress MediaPipe/TensorFlow WASM delegate initialization logs which trigger Next.js error overlays
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (typeof args[0] === 'string' && (
        args[0].includes('Created TensorFlow Lite XNNPACK delegate') ||
        args[0].includes('Wasm')
      )) {
        return; // Ignore
      }
      originalConsoleError.apply(console, args);
    };

    const { avatarLoader } = require('../utils/avatarRenderer');
    avatarLoader.preloadAll();
    
    return () => {
      // Restore on unmount
      console.error = originalConsoleError;
    };
  }, []);

  // Enumerate Devices
  useEffect(() => {
    async function getDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        
        setCameras(videoDevices);
        setMicrophones(audioDevices);

        if (videoDevices.length > 0 && !selectedCamera) {
          setSelectedCamera(videoDevices[0].deviceId);
        }
        if (audioDevices.length > 0 && !selectedMic) {
          setSelectedMic(audioDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    }
    
    // Request permission first
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(() => getDevices())
      .catch(err => console.error('Media permission denied', err));
  }, []);

  // Setup Streams
  useEffect(() => {
    if (!selectedCamera) return;

    let activeStream: MediaStream | null = null;

    async function startStream() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: {
            deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true
        };

        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(activeStream);

        if (videoRef.current) {
          videoRef.current.srcObject = activeStream;
          videoRef.current.play().catch(e => console.log('Video play interrupted', e));
        }

        // Setup Audio Analyser
        setupAudioAnalyser(activeStream);
      } catch (err) {
        console.error('Error starting media stream:', err);
      }
    }

    startStream();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [selectedCamera, selectedMic]);

  // Audio Analyser Setup
  const setupAudioAnalyser = (mediaStream: MediaStream) => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      audioContextRef.current = ctx;
      audioAnalyserRef.current = analyser;
    } catch (e) {
      console.error('AudioContext creation failed', e);
    }
  };



  // Main canvas drawing and face landmark tracking loop
  useEffect(() => {
    const video = videoRef.current;
    const canvas2D = canvas2DRef.current;
    
    if (!video) return;

    const runLoop = () => {
      // Pause canvas drawing while in review mode to not overdraw the preview video
      if (recordingStateRef.current === 'review') {
        animationFrameIdRef.current = requestAnimationFrame(runLoop);
        return;
      }

      const targetSize = ASPECT_RATIOS[aspectRatio];
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = targetSize.width / targetSize.height;
      
      let drawW = targetSize.width;
      let drawH = targetSize.height;
      let offsetX = 0;
      let offsetY = 0;

      if (videoRatio > canvasRatio) {
        // Video is wider, crop horizontal margins
        drawW = targetSize.height * videoRatio;
        offsetX = -(drawW - targetSize.width) / 2;
      } else {
        // Video is taller, crop vertical margins
        drawH = targetSize.width / videoRatio;
        offsetY = -(drawH - targetSize.height) / 2;
      }

      // 1. Process 2D Canvas if it exists
      if (canvas2D) {
        const ctx2D = canvas2D.getContext('2d');
        if (ctx2D) {
          // Adjust canvas size internally
          if (canvas2D.width !== targetSize.width || canvas2D.height !== targetSize.height) {
            canvas2D.width = targetSize.width;
            canvas2D.height = targetSize.height;
          }

          // A helper function to draw the raw camera feed center-cropped
          const drawRawCamera = () => {
            ctx2D.save();
            // Mirror effect for natural webcam preview
            ctx2D.translate(targetSize.width, 0);
            ctx2D.scale(-1, 1);
            // Draw cropped camera feed
            ctx2D.drawImage(video, offsetX, offsetY, drawW, drawH);
            ctx2D.restore();
          };

          // Draw the background on canvas2D based on selector
          if (backgroundType === 'camera' || avatarType === 'none') {
            drawRawCamera();
          } else {
            drawBackground(ctx2D, targetSize.width, targetSize.height, backgroundType);
          }

          // 2. Perform Face Landmarker detection
          let faceData: FaceData | null = null;
          if (landmarkerRef.current && video && !video.paused && !video.ended && video.readyState >= 2) {
            const nowMs = performance.now();
            if (nowMs > lastVideoTimeRef.current) {
              lastVideoTimeRef.current = nowMs;
              try {
                const results = landmarkerRef.current.detectForVideo(video, nowMs);
                if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                  const landmarks = results.faceLandmarks[0];
                  const blendshapes = results.faceBlendshapes?.[0]?.categories || [];

                  const eyeL = landmarks[33];
                  const eyeR = landmarks[263];
                  const forehead = landmarks[10];
                  const chin = landmarks[152];
                  const cheekL = landmarks[234];
                  const cheekR = landmarks[454];

                  if (eyeL && eyeR && forehead && chin && cheekL && cheekR) {
                    // Helper for 3D distance
                    const dist = (p1: any, p2: any) => {
                      if (!p1 || !p2) return 0;
                      return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
                    };

                    // 1. Calculate Eye Aspect Ratio (EAR) for blinking
                    const leftEAR = dist(landmarks[159], landmarks[145]) / (dist(landmarks[33], landmarks[133]) || 1);
                    const rightEAR = dist(landmarks[386], landmarks[374]) / (dist(landmarks[263], landmarks[362]) || 1);
                    const avgEAR = (leftEAR + rightEAR) / 2;

                    // 2. Calculate Mouth Aspect Ratio (MAR) for speech talking sync
                    const rawMAR = dist(landmarks[13], landmarks[14]) / (dist(landmarks[61], landmarks[291]) || 1);

                    // Project coordinates to cropped canvas viewport
                    const cx = offsetX + ((1 - eyeL.x) + (1 - eyeR.x)) / 2 * drawW;
                    const cy = offsetY + (forehead.y + chin.y) / 2 * drawH;
                    
                    const xCheekL = offsetX + (1 - cheekL.x) * drawW;
                    const xCheekR = offsetX + (1 - cheekR.x) * drawW;
                    const yCheekL = offsetY + cheekL.y * drawH;
                    const yCheekR = offsetY + cheekR.y * drawH;
                    
                    const faceWidth = Math.sqrt((xCheekL - xCheekR)**2 + (yCheekL - yCheekR)**2);
                    const scaleVal = (faceWidth * 2.6) / 300; 

                    let rollAngle = 0;
                    {
                      const lx = offsetX + (1 - eyeL.x) * drawW;
                      const ly = offsetY + eyeL.y * drawH;
                      const rx = offsetX + (1 - eyeR.x) * drawW;
                      const ry = offsetY + eyeR.y * drawH;
                      rollAngle = Math.atan2(ly - ry, lx - rx);
                    }

                    // LERP Smoothing Pipeline (alpha = 0.25)
                    const alpha = 0.25;
                    if (smoothedCxRef.current === null || smoothedCyRef.current === null || smoothedScaleRef.current === null || smoothedRotationRef.current === null || smoothedMarRef.current === null) {
                      smoothedCxRef.current = cx;
                      smoothedCyRef.current = cy;
                      smoothedScaleRef.current = scaleVal;
                      smoothedRotationRef.current = rollAngle;
                      smoothedMarRef.current = rawMAR;
                    } else {
                      smoothedCxRef.current += (cx - smoothedCxRef.current) * alpha;
                      smoothedCyRef.current += (cy - smoothedCyRef.current) * alpha;
                      smoothedScaleRef.current += (scaleVal - smoothedScaleRef.current) * alpha;
                      smoothedMarRef.current += (rawMAR - smoothedMarRef.current) * alpha;

                      let diff = rollAngle - smoothedRotationRef.current;
                      while (diff < -Math.PI) diff += Math.PI * 2;
                      while (diff > Math.PI) diff -= Math.PI * 2;
                      smoothedRotationRef.current += diff * alpha;
                    }

                    const bsMap: Record<string, number> = {};
                    blendshapes.forEach(b => { bsMap[b.categoryName] = b.score; });

                    faceData = {
                      cx: smoothedCxRef.current!,
                      cy: smoothedCyRef.current!,
                      scale: smoothedScaleRef.current!,
                      rotation: smoothedRotationRef.current!,
                      isLeftEyeOpen: leftEAR >= 0.18,
                      isRightEyeOpen: rightEAR >= 0.18,
                      mouthOpenRatio: bsMap['jawOpen'] || 0,
                      smileIntensity: ((bsMap['mouthSmileLeft'] || 0) + (bsMap['mouthSmileRight'] || 0)) / 2,
                      avgEAR: avgEAR,
                      mar: smoothedMarRef.current!
                    };
                  }
                } else {
                  // Reset LERP refs when tracking is lost so it snaps cleanly next time
                  smoothedCxRef.current = null;
                  smoothedCyRef.current = null;
                  smoothedScaleRef.current = null;
                  smoothedRotationRef.current = null;
                  smoothedMarRef.current = null;
                }
              } catch (_) {
                // Silently handle detection glitches
              }
            }
          }

          // 3. Render 2D Cartoon Avatar elements if active
          if (avatarType !== 'none') {
            if (faceData) {
              if (backgroundType !== 'camera') {
                drawCartoonBody(ctx2D, faceData.cx, faceData.cy, faceData.scale, avatarType);
              }
              draw2DAvatar(ctx2D, avatarType, faceData);
            } else {
              ctx2D.fillStyle = 'rgba(255, 255, 255, 0.9)';
              ctx2D.font = `${20 * (targetSize.width / 720)}px var(--font-body)`;
              ctx2D.textAlign = 'center';
              ctx2D.fillText(
                isLandmarkerLoading ? 'Loading tracking model...' : 'Looking for face...',
                targetSize.width / 2,
                targetSize.height / 2
              );
            }
          }
        }
      }

      // Update Audio levels for glowing overlay effect
      if (audioAnalyserRef.current) {
        const dataArray = new Uint8Array(audioAnalyserRef.current.frequencyBinCount);
        audioAnalyserRef.current.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((acc, v) => acc + v, 0);
        const avg = sum / dataArray.length;
        // Normalize value between 0 and 1
        setMicVolume(Math.min(1, avg / 128));
      }

      animationFrameIdRef.current = requestAnimationFrame(runLoop);
    };

    animationFrameIdRef.current = requestAnimationFrame(runLoop);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [aspectRatio, avatarType, backgroundType]);

  // Start countdown before recording
  const initiateRecording = () => {
    if (recordingState !== 'idle') return;
    setRecordingStateSynced('countdown');
    setCountdown(3);
    
    const countInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countInterval);
          startRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Start recording actual media (runs concurrent HD and SD MediaRecorders)
  const startRecording = () => {
    if (!stream) return;
    
    recordedChunksRefHD.current = [];
    recordedChunksRefSD.current = [];
    
    const recordCanvas = canvas2DRef.current;
      
    if (!recordCanvas) {
      setRecordingStateSynced('idle');
      return;
    }

    try {
      // 1. Capture 30 FPS video track from Canvas
      const canvasStream = recordCanvas.captureStream(30);
      const videoTrack = canvasStream.getVideoTracks()[0];

      // 2. Fetch mic audio track
      const audioTrack = stream.getAudioTracks()[0];

      // 3. Assemble composite streams
      const compositeStreamHD = new MediaStream();
      if (videoTrack) compositeStreamHD.addTrack(videoTrack.clone());
      if (audioTrack) compositeStreamHD.addTrack(audioTrack);

      const compositeStreamSD = new MediaStream();
      if (videoTrack) compositeStreamSD.addTrack(videoTrack.clone());
      if (audioTrack) compositeStreamSD.addTrack(audioTrack);

      // 4. Find supported mimeType
      const mimeType = getSupportedMimeType();
      
      const optionsHD = {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 8000000 // 8 Mbps for High Definition
      };

      const optionsSD = {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 2000000 // 2 Mbps for Standard Definition
      };

      console.log('Initializing Dual MediaRecorders. Mime:', mimeType || 'default');
      const mediaRecorderHD = new MediaRecorder(compositeStreamHD, optionsHD);
      const mediaRecorderSD = new MediaRecorder(compositeStreamSD, optionsSD);
      
      // Setup data listeners
      mediaRecorderHD.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRefHD.current.push(event.data);
        }
      };

      mediaRecorderSD.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRefSD.current.push(event.data);
        }
      };

      mediaRecorderHD.onerror = (err) => {
        console.error('HD MediaRecorder error:', err);
      };
      mediaRecorderSD.onerror = (err) => {
        console.error('SD MediaRecorder error:', err);
      };

      // Set stop handling
      mediaRecorderHD.onstop = () => {
        const actualType = mediaRecorderHD.mimeType || mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRefHD.current, { type: actualType });
        const url = URL.createObjectURL(blob);
        setRecordedUrlHD(url);
        setRecordingStateSynced('review');

        // Stop canvas capture stream track to release memory
        if (videoTrack) {
          try {
            videoTrack.stop();
          } catch (e) {}
        }
      };

      mediaRecorderSD.onstop = () => {
        const actualType = mediaRecorderSD.mimeType || mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRefSD.current, { type: actualType });
        const url = URL.createObjectURL(blob);
        setRecordedUrlSD(url);
      };

      // Clear active recording timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }

      mediaRecorderRefHD.current = mediaRecorderHD;
      mediaRecorderRefSD.current = mediaRecorderSD;
      
      // Start both recorders
      mediaRecorderHD.start(); 
      mediaRecorderSD.start(); 
      console.log('Dual MediaRecorders started successfully.');

      setRecordingStateSynced('recording');
      setRecordingTime(0);

      // Start elapsed timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (e) {
      console.error('Failed to start dual recording:', e);
      setRecordingStateSynced('idle');
    }
  };

  // Helper to check supported MimeTypes in browsers (prioritize MP4)
  const getSupportedMimeType = () => {
    const types = [
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  };

  // Pause recording
  const pauseRecording = () => {
    if (mediaRecorderRefHD.current && recordingState === 'recording') {
      mediaRecorderRefHD.current.pause();
      mediaRecorderRefSD.current?.pause();
      setRecordingStateSynced('paused');
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  // Resume recording
  const resumeRecording = () => {
    if (mediaRecorderRefHD.current && recordingState === 'paused') {
      mediaRecorderRefHD.current.resume();
      mediaRecorderRefSD.current?.resume();
      setRecordingStateSynced('recording');
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
  };

  // Stop recording
  const stopRecording = () => {
    setRecordingStateSynced('review');
    if (mediaRecorderRefHD.current && mediaRecorderRefHD.current.state !== 'inactive') {
      try { mediaRecorderRefHD.current.requestData(); } catch (e) {}
      mediaRecorderRefHD.current.stop();
    }
    if (mediaRecorderRefSD.current && mediaRecorderRefSD.current.state !== 'inactive') {
      try { mediaRecorderRefSD.current.requestData(); } catch (e) {}
      mediaRecorderRefSD.current.stop();
    }
  };

  // Retake recording
  const handleRetake = () => {
    setRecordingStateSynced('idle');
    setRecordingTime(0);
    setShowDownloadMenu(false);
    setTimeout(() => {
      if (recordedUrlHD) {
        URL.revokeObjectURL(recordedUrlHD);
      }
      if (recordedUrlSD) {
        URL.revokeObjectURL(recordedUrlSD);
      }
      setRecordedUrlHD(null);
      setRecordedUrlSD(null);
    }, 100);
  };

  // Download recorded video (force MP4 container output file)
  const handleDownload = (quality: 'hd' | 'sd') => {
    const url = quality === 'hd' ? recordedUrlHD : recordedUrlSD;
    if (!url) return;

    const timeString = new Date().toISOString().split('T')[0];
    const qualityLabel = quality === 'hd' ? 'HD' : 'SD';
    const fileName = `SpeakGarden_${aspectRatio.replace(':', 'x')}_${qualityLabel}_${timeString}.mp4`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  // Helper formatting seconds to MM:SS
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };



  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-6xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div 
            className="p-3 rounded-2xl shadow-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            <Video className="w-6 h-6" style={{ color: '#ffffff' }} />
          </div>
          <div>
            <h1 
              className="text-3xl font-extrabold tracking-tight"
              style={{ 
                background: 'linear-gradient(135deg, #1e1b4b 0%, #4f46e5 50%, #7c3aed 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              Satrn<span style={{ color: '#6366f1', WebkitTextFillColor: '#6366f1' }}>.io</span>
            </h1>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              AI Portrait & Interactive Cartoon Avatar Recorder
            </p>
          </div>
        </div>
        
        {/* Loading Indicators */}
        <div className="flex items-center gap-4 text-xs">
          {isLandmarkerLoading && (
            <div className="flex items-center gap-2 text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-full border border-indigo-500/20">
              <Sparkles className="w-4.5 h-4.5 animate-spin" />
              <span>Downloading Face AI model...</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Grid Workspace */}
      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-12">
        
        {/* Left Column: Viewport & Recording Console */}
        <section className="lg:col-span-7 flex flex-col items-center gap-6">
          
          {/* Responsive Camera Frame Container */}
          <div 
            className="w-full relative z-0 glass-panel overflow-hidden flex items-center justify-center border-indigo-500/20 transition-all duration-300"
            style={{ 
              aspectRatio: ASPECT_RATIOS[aspectRatio].ratio,
              maxHeight: '62vh',
              boxShadow: micVolume > 0.05 
                ? `0 0 ${15 + micVolume * 35}px rgba(99, 102, 241, ${0.1 + micVolume * 0.5})` 
                : 'var(--shadow-md)'
            }}
          >
            {/* Hidden raw video feed */}
            <video 
              ref={videoRef}
              className="hidden"
              playsInline
              muted
            />

            {/* Canvas 2D (Default rendering / 2D Avatar) */}
            <canvas 
              ref={canvas2DRef}
              className="w-full h-full object-contain"
              style={{ display: recordingState === 'review' ? 'none' : 'block' }}
            />

            {/* Overlay: Countdown Overlay */}
            {recordingState === 'countdown' && (
              <div className="absolute inset-0 bg-black/75 z-40 flex items-center justify-center backdrop-blur-sm">
                <span className="text-8xl font-black text-white animate-scale-up-fade">
                  {countdown}
                </span>
              </div>
            )}

            {/* Overlay: Active Review Overlay */}
            {recordingState === 'review' && (recordedUrlHD || recordedUrlSD) && (
              <div className="absolute inset-0 bg-black z-30 flex items-center justify-center">
                <video 
                  key={recordedUrlHD || recordedUrlSD || 'review'}
                  src={recordedUrlHD || recordedUrlSD || undefined} 
                  controls 
                  className="w-full h-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                  onLoadedData={(e) => {
                    const vid = e.currentTarget;
                    vid.play().catch(() => {});
                    // Unmute after a short delay so user hears audio on loop
                    setTimeout(() => { vid.muted = false; }, 300);
                  }}
                />
              </div>
            )}

            {/* Overlay: Timer & Recording status indicators */}
            {(recordingState === 'recording' || recordingState === 'paused') && (
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2.5 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                <span className={`w-2.5 h-2.5 rounded-full bg-rose-500 ${recordingState === 'recording' ? 'animate-pulse-recording' : ''}`} />
                <span className="text-xs font-mono font-semibold tracking-wider">
                  {formatTime(recordingTime)}
                </span>
                {recordingState === 'paused' && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.5 rounded uppercase">
                    Paused
                  </span>
                )}
              </div>
            )}

            {/* Overlay: Audio Pulsing ring indicator */}
            {recordingState === 'recording' && (
              <div 
                className="absolute bottom-4 right-4 z-20 p-2.5 rounded-full bg-black/60 border border-white/10 backdrop-blur-md flex items-center justify-center"
                title="Microphone input active"
              >
                <Volume2 className="w-4 h-4 text-indigo-400" />
              </div>
            )}
          </div>

          {/* Action Recorder Console & Review buttons Card */}
          <div className="glass-panel p-5 w-full flex items-center justify-center min-h-[96px] relative z-20">
            {recordingState === 'review' && (
              <div className="flex gap-4 w-full justify-center max-w-sm">
                <button 
                  onClick={handleRetake}
                  className="flex-1 py-3 px-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 shadow transition"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                  Retake
                </button>
                <div className="relative flex-1 flex">
                  <button 
                    onClick={() => handleDownload('hd')}
                    className="flex-1 py-3 px-4 rounded-l-xl bg-gradient-to-r from-indigo-500 to-indigo-650 hover:opacity-90 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/20 transition"
                  >
                    <Download className="w-4 h-4" />
                    Download HD
                  </button>
                  <button 
                    onClick={() => setShowDownloadMenu(prev => !prev)}
                    className="py-3 px-3 rounded-r-xl bg-indigo-700 hover:bg-indigo-800 text-white border-l border-indigo-600 shadow-lg transition flex items-center justify-center"
                    title="Choose download quality"
                  >
                    <span className="text-[10px] font-bold">SD</span>
                  </button>
                  
                  {showDownloadMenu && (
                    <div 
                      className="absolute bottom-full right-0 mb-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 flex flex-col"
                      style={{ backgroundColor: '#ffffff' }}
                    >
                      <button
                        onClick={() => handleDownload('hd')}
                        className="px-4 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        HD Quality (8 Mbps)
                      </button>
                      <button
                        onClick={() => handleDownload('sd')}
                        className="px-4 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition flex items-center gap-2"
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        SD Quality (2 Mbps)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {recordingState === 'idle' && (
              <button
                onClick={initiateRecording}
                disabled={isLandmarkerLoading}
                className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 hover:scale-105 active:scale-95 disabled:bg-slate-350 disabled:text-slate-500 disabled:scale-100 flex items-center justify-center shadow-lg shadow-rose-500/30 transition-all border-4 border-white"
                title="Start Recording"
              >
                <div className="w-6 h-6 rounded-full bg-white" />
              </button>
            )}

            {recordingState === 'countdown' && (
              <button
                className="w-16 h-16 rounded-full bg-slate-200 border-4 border-white flex items-center justify-center text-slate-400 cursor-not-allowed"
                disabled
              >
                <span className="font-bold text-sm animate-pulse">Wait</span>
              </button>
            )}

            {(recordingState === 'recording' || recordingState === 'paused') && (
              <div className="flex gap-4 items-center justify-center">
                {recordingState === 'recording' ? (
                  <button
                    onClick={pauseRecording}
                    className="w-12 h-12 rounded-full bg-slate-200 hover:bg-slate-300 active:scale-95 text-amber-600 border border-slate-300 flex items-center justify-center shadow-md transition"
                    title="Pause Recording"
                  >
                    <Pause className="w-5 h-5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={resumeRecording}
                    className="w-12 h-12 rounded-full bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-600 border border-indigo-200 flex items-center justify-center shadow-md transition animate-pulse"
                    title="Resume Recording"
                  >
                    <Play className="w-5 h-5 fill-current" />
                  </button>
                )}

                <button
                  onClick={stopRecording}
                  className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-650 hover:scale-105 active:scale-95 text-white border-4 border-white flex items-center justify-center shadow-lg shadow-rose-500/30 transition-all"
                  title="Stop Recording"
                >
                  <Square className="w-6 h-6 fill-current" />
                </button>
              </div>
            )}
          </div>

          {/* Prompt status alert info */}
          {avatarType !== 'none' && !isLandmarkerReady && !isLandmarkerLoading && (
            <p className="text-xs text-rose-400 text-center">
              ⚠️ Face landmark tracking model failed to load. Running in raw mode.
            </p>
          )}
        </section>

        {/* Right Column: Control Settings Panel */}
        <section className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Card: Dimensions Picker */}
          <div className="glass-panel p-5">
            <h2 className="text-sm font-semibold mb-4 text-slate-800 flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-indigo-500" />
              1. Aspect Ratio Dimensions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((key) => {
                const active = aspectRatio === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAspectRatio(key)}
                    disabled={recordingState !== 'idle'}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition ${
                      active 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50'
                    }`}
                  >
                    <span className="text-xs font-semibold">{key === '9:16' ? '9:16 (Portrait)' : key === '1:1' ? '1:1 (Square)' : key === '16:9' ? '16:9 (Landscape)' : '4:3 (Classic)'}</span>
                    <span className="text-[10px] text-slate-400">
                      {ASPECT_RATIOS[key].width} × {ASPECT_RATIOS[key].height}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card: Filter Engine (Avatars) */}
          <div className="glass-panel p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                2. Cartoon Avatar Filters
              </h2>
            </div>

            {/* List of filters */}
            <div className="grid grid-cols-3 gap-2">
              {(['none', 'bear', 'cat', 'panda', 'dog', 'rabbit'] as AvatarType[]).map((type) => {
                const active = avatarType === type;
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setAvatarType(type);
                    }}
                    className={`py-3.5 px-2.5 rounded-xl border text-center flex flex-col items-center gap-2 uppercase tracking-wide text-[10px] font-semibold transition ${
                      active 
                        ? 'border-indigo-500 bg-indigo-650 text-white shadow-md' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {/* Stylized Emoji Previews */}
                    <span className="text-2xl">
                      {type === 'none' ? '👤' : type === 'bear' ? '🐻' : type === 'cat' ? '🐱' : type === 'panda' ? '🐼' : type === 'dog' ? '🐶' : '🐰'}
                    </span>
                    <span>{type === 'none' ? 'Raw Feed' : type}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card: Input Devices Settings */}
          <div className="glass-panel p-5 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-500" />
              3. Input Devices
            </h2>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  Camera source
                </label>
                <select
                  value={selectedCamera}
                  onChange={(e) => setSelectedCamera(e.target.value)}
                  disabled={recordingState !== 'idle'}
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-slate-800 transition disabled:opacity-50"
                >
                  {cameras.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${cameras.indexOf(d) + 1}`}
                    </option>
                  ))}
                  {cameras.length === 0 && <option value="">No cameras found</option>}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                  <Mic className="w-3.5 h-3.5" />
                  Microphone source
                </label>
                <select
                  value={selectedMic}
                  onChange={(e) => setSelectedMic(e.target.value)}
                  disabled={recordingState !== 'idle'}
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-slate-800 transition disabled:opacity-50"
                >
                  {microphones.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${microphones.indexOf(d) + 1}`}
                    </option>
                  ))}
                  {microphones.length === 0 && <option value="">No microphones found</option>}
                </select>
              </div>


            </div>
          </div>

        </section>
      </main>
    </div>
  );
}
