'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Camera, Mic, Settings, Download, RotateCcw, Play, Pause, Square, 
  Sparkles, Trash2, Video, Volume2, Monitor, RefreshCw, LayoutGrid,
  User, Cat, Dog, Smile, Sun, Moon, Thermometer, Film, Zap, Palette,
  ChevronLeft, ChevronRight, FileText, Subtitles, Eye, EyeOff, Loader2, Type
} from 'lucide-react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { drawBackground, drawCartoonBody, draw2DAvatar, AvatarType, BackgroundType, FaceData } from '../utils/avatarRenderer';
import type { AlignedWord } from '../utils/lyricsAligner';

export type CameraFilter = 'none' | 'pop' | 'bw' | 'cool' | 'chrome' | 'film' | 'warm' | 'tv' | 'leak' | 'touchup';

const CAMERA_FILTERS: { value: CameraFilter; label: string; icon: React.ComponentType<any> }[] = [
  { value: 'none', label: 'Normal', icon: Video },
  { value: 'pop', label: 'Pop', icon: Sparkles },
  { value: 'bw', label: 'B&W', icon: Moon },
  { value: 'cool', label: 'Cool', icon: Thermometer },
  { value: 'chrome', label: 'Chrome', icon: Palette },
  { value: 'film', label: 'Film', icon: Film },
  { value: 'warm', label: 'Warm', icon: Sun },
  { value: 'leak', label: 'Light Leak', icon: Zap },
  { value: 'tv', label: 'Vintage TV', icon: Monitor },
  { value: 'touchup', label: 'Touch Up', icon: Smile },
];


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
  const [recordedBlobHD, setRecordedBlobHD] = useState<Blob | null>(null);
  const [recordedBlobSD, setRecordedBlobSD] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>('none');

  // 4. Lyrics Sync States
  const [lyricsText, setLyricsText] = useState<string>('');
  const [alignedWords, setAlignedWords] = useState<AlignedWord[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [isHD, setIsHD] = useState<boolean>(true);
  const [burnProgress, setBurnProgress] = useState<number | null>(null);
  const [isTeleprompter, setIsTeleprompter] = useState<boolean>(false);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState<number>(25); // px/sec
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null);
  
  // Page Visibility State
  const [isPageVisible, setIsPageVisible] = useState<boolean>(true);
  const [dragState, setDragState] = useState<{
    wordIdx: number;
    type: 'move' | 'resize-start' | 'resize-end';
    startX: number;
    startValStart: number;
    startValEnd: number;
  } | null>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef<boolean>(false);
  const scrubStartXRef = useRef<number>(0);
  const scrubStartTimeRef = useRef<number>(0);
  const [reviewCurrentTime, setReviewCurrentTime] = useState<number>(0);

  // Keep a ref in sync so the animation loop can read it without triggering re-mounts
  const setRecordingStateSynced = (next: 'idle' | 'countdown' | 'recording' | 'paused' | 'review') => {
    recordingStateRef.current = next;
    setRecordingState(next);
  };
  
  // 5. Audio Visualizer State
  const [micVolume, setMicVolume] = useState<number>(0);
  const [filterPage, setFilterPage] = useState<number>(0);

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

  // Monitor page visibility and focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    
    const handleBlur = () => setIsPageVisible(false);
    const handleFocus = () => setIsPageVisible(true);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Calculate if camera should be active
  const shouldCameraBeActive = recordingState !== 'review' && (isPageVisible || recordingState === 'recording' || recordingState === 'paused' || recordingState === 'countdown');

  // Setup Streams
  useEffect(() => {
    if (!selectedCamera || !shouldCameraBeActive) {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }
      return;
    }

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
  }, [selectedCamera, selectedMic, shouldCameraBeActive]);

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

          const getFilterString = (f: CameraFilter) => {
            switch (f) {
              case 'pop':     return 'contrast(1.25) saturate(1.35) brightness(1.04)';
              case 'bw':      return 'grayscale(1) contrast(1.2) brightness(0.98)';
              case 'cool':    return 'saturate(1.15) hue-rotate(-12deg) brightness(0.96) contrast(1.05)';
              case 'chrome':  return 'contrast(1.35) saturate(1.4) brightness(0.98)';
              case 'film':    return 'sepia(0.2) contrast(0.95) brightness(1.02) saturate(0.9)';
              case 'warm':    return 'sepia(0.35) saturate(1.25) contrast(1.05) brightness(1.02)';
              case 'tv':      return 'contrast(1.1) brightness(1.03) saturate(0.8) sepia(0.05)';
              default:        return 'none';
            }
          };

          ctx2D.filter = getFilterString(cameraFilter);

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

                    // Implement Touch Up / Skin Smoothing face mask overlay
                    if (cameraFilter === 'touchup') {
                      const faceOvalIndices = [
                        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
                        400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
                        54, 103, 67, 109
                      ];
                      
                      ctx2D.save();
                      ctx2D.beginPath();
                      faceOvalIndices.forEach((idx, i) => {
                        const p = landmarks[idx];
                        const x = offsetX + (1 - p.x) * drawW;
                        const y = offsetY + p.y * drawH;
                        if (i === 0) ctx2D.moveTo(x, y);
                        else ctx2D.lineTo(x, y);
                      });
                      ctx2D.closePath();
                      ctx2D.clip();
                      
                      // Draw soft blurred skin at 45% opacity
                      ctx2D.globalAlpha = 0.45;
                      ctx2D.filter = 'blur(6px) contrast(1.02) brightness(1.02)';
                      
                      ctx2D.translate(targetSize.width, 0);
                      ctx2D.scale(-1, 1);
                      ctx2D.drawImage(video, offsetX, offsetY, drawW, drawH);
                      ctx2D.restore();
                    }
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

          // 4. Draw camera filter specific overlays on top of everything
          if (cameraFilter === 'tv') {
            ctx2D.save();
            ctx2D.filter = 'none'; // reset color filters for overlays
            ctx2D.strokeStyle = 'rgba(0, 0, 0, 0.07)';
            ctx2D.lineWidth = 1;
            for (let y = 0; y < targetSize.height; y += 4) {
              ctx2D.beginPath();
              ctx2D.moveTo(0, y);
              ctx2D.lineTo(targetSize.width, y);
              ctx2D.stroke();
            }

            // CRT curved lens dark vignette overlay
            const grad = ctx2D.createRadialGradient(
              targetSize.width / 2, targetSize.height / 2, targetSize.width * 0.45,
              targetSize.width / 2, targetSize.height / 2, targetSize.width * 0.7
            );
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,0.45)');
            ctx2D.fillStyle = grad;
            ctx2D.fillRect(0, 0, targetSize.width, targetSize.height);
            ctx2D.restore();
          } else if (cameraFilter === 'leak') {
            ctx2D.save();
            ctx2D.filter = 'none';
            ctx2D.globalCompositeOperation = 'screen';
            const grad = ctx2D.createLinearGradient(0, 0, targetSize.width, targetSize.height);
            grad.addColorStop(0, 'rgba(249, 115, 22, 0.25)'); // Orange light leak
            grad.addColorStop(0.3, 'rgba(236, 72, 153, 0.15)'); // Pink
            grad.addColorStop(0.7, 'rgba(99, 102, 241, 0.08)');  // Indigo
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx2D.fillStyle = grad;
            ctx2D.fillRect(0, 0, targetSize.width, targetSize.height);
            ctx2D.restore();
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
  }, [aspectRatio, avatarType, backgroundType, cameraFilter]);

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
        setRecordedBlobHD(blob);
        setRecordedUrlHD(url);
        setRecordingStateSynced('review');

        // Auto-trigger lyrics alignment if lyrics were entered
        if (lyricsText.trim()) {
          triggerLyricsAlignment(blob);
        }

        // Stop canvas capture stream track to release memory
        if (videoTrack) {
          try { videoTrack.stop(); } catch (e) {}
        }
      };

      mediaRecorderSD.onstop = () => {
        const actualType = mediaRecorderSD.mimeType || mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRefSD.current, { type: actualType });
        const url = URL.createObjectURL(blob);
        setRecordedBlobSD(blob);
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
    setAlignedWords([]);
    setIsSyncing(false);
    setSyncStatus('');
    setSyncError(null);
    setBurnProgress(null);
    setSelectedWordIndex(null);
    setTimeout(() => {
      if (recordedUrlHD) URL.revokeObjectURL(recordedUrlHD);
      if (recordedUrlSD) URL.revokeObjectURL(recordedUrlSD);
      setRecordedUrlHD(null);
      setRecordedUrlSD(null);
      setRecordedBlobHD(null);
      setRecordedBlobSD(null);
    }, 100);
  };

  // Adjust timing of a specific word manually with constraints
  const adjustWordTime = (index: number, field: 'start' | 'end', delta: number) => {
    setAlignedWords(prev => {
      const next = prev.map(item => ({ ...item }));
      const word = next[index];
      
      if (field === 'start') {
        word.start = Math.max(0, parseFloat((word.start + delta).toFixed(2)));
        if (word.start + 0.05 > word.end) {
          word.start = parseFloat((word.end - 0.05).toFixed(2));
        }
        if (index > 0 && word.start < next[index - 1].start) {
          word.start = next[index - 1].start;
        }
      } else {
        word.end = parseFloat((word.end + delta).toFixed(2));
        if (word.end < word.start + 0.05) {
          word.end = parseFloat((word.start + 0.05).toFixed(2));
        }
        if (index < next.length - 1 && word.end > next[index + 1].end) {
          word.end = next[index + 1].end;
        }
      }

      // Re-enforce strictly monotonic timing across the rest of the array
      for (let i = 1; i < next.length; i++) {
        if (next[i].start < next[i - 1].end) {
          next[i].start = next[i - 1].end;
        }
        if (next[i].end <= next[i].start) {
          next[i].end = next[i].start + 0.05;
        }
      }

      return next;
    });
  };

  // Seek preview video to word start time
  const handleWordClick = (index: number) => {
    setSelectedWordIndex(index);
    if (reviewVideoRef.current) {
      reviewVideoRef.current.currentTime = alignedWords[index].start;
    }
  };

  // Pointer Down for Timeline word drag/resize
  const handleTimelinePointerDown = (
    e: React.PointerEvent,
    wordIdx: number,
    type: 'move' | 'resize-start' | 'resize-end'
  ) => {
    e.stopPropagation();
    const w = alignedWords[wordIdx];
    if (!w) return;
    
    setDragState({
      wordIdx,
      type,
      startX: e.clientX,
      startValStart: w.start,
      startValEnd: w.end,
    });
    
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  // Pointer Move (calculate delta and update Word start/end with constraints)
  const handleTimelinePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const w = alignedWords[dragState.wordIdx];
    if (!w) return;
    
    const deltaX = e.clientX - dragState.startX;
    const pxPerSec = 90; // match timeline zoom
    const deltaTime = deltaX / pxPerSec;
    const duration = reviewVideoRef.current?.duration || recordingTime || 10;

    setAlignedWords(prev => {
      const next = prev.map(item => ({ ...item }));
      const target = next[dragState.wordIdx];
      
      if (dragState.type === 'resize-start') {
        const candidate = parseFloat((dragState.startValStart + deltaTime).toFixed(2));
        target.start = Math.max(0, Math.min(candidate, target.end - 0.05));
      } else if (dragState.type === 'resize-end') {
        const candidate = parseFloat((dragState.startValEnd + deltaTime).toFixed(2));
        target.end = Math.max(target.start + 0.05, Math.min(candidate, duration));
      } else if (dragState.type === 'move') {
        const diff = target.end - target.start;
        const candidateStart = parseFloat((dragState.startValStart + deltaTime).toFixed(2));
        let newStart = Math.max(0, Math.min(candidateStart, duration - diff));
        
        target.start = newStart;
        target.end = newStart + diff;
      }

      // 1. Resolve collisions forward (if dragged item pushed items to the right)
      for (let i = dragState.wordIdx + 1; i < next.length; i++) {
        if (next[i].start < next[i - 1].end) {
          next[i].start = next[i - 1].end;
        }
        if (next[i].end <= next[i].start) {
          next[i].end = Math.min(duration, next[i].start + 0.05);
        }
      }

      // 2. Resolve collisions backward (if dragged item pushed items to the left)
      for (let i = dragState.wordIdx - 1; i >= 0; i--) {
        if (next[i].end > next[i + 1].start) {
          next[i].end = next[i + 1].start;
        }
        if (next[i].start >= next[i].end) {
          next[i].start = Math.max(0, next[i].end - 0.05);
        }
      }

      return next;
    });
  };

  // Pointer Up
  const handleTimelinePointerUp = (e: React.PointerEvent) => {
    if (dragState) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
      setDragState(null);
    }
  };

  // Scroll event for manual timeline scrubbing/dragging
  const handleTimelineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    const container = e.currentTarget;
    const pxPerSec = 90;
    const duration = reviewVideoRef.current?.duration || recordingTime || 10;
    
    // With 50% left padding, scrollLeft=0 maps exactly to time 0s.
    const targetTime = container.scrollLeft / pxPerSec;
    const boundedTime = Math.max(0, Math.min(targetTime, duration));
    
    if (reviewVideoRef.current) {
      reviewVideoRef.current.currentTime = boundedTime;
    }
    setReviewCurrentTime(boundedTime);
  };

  // Download recorded video (force MP4 container output, burn subtitles if enabled and aligned)
  const handleDownload = async (quality: 'hd' | 'sd') => {
    const rawUrl = quality === 'hd' ? recordedUrlHD : recordedUrlSD;
    const rawBlob = quality === 'hd' ? recordedBlobHD : recordedBlobSD;
    if (!rawUrl || !rawBlob) return;

    const timeString = new Date().toISOString().split('T')[0];
    const qualityLabel = quality === 'hd' ? 'HD' : 'SD';
    const fileName = `SpeakGarden_${aspectRatio.replace(':', 'x')}_${qualityLabel}_${timeString}.mp4`;

    // If subtitles are turned on and aligned words are loaded, burn them in frame-by-frame
    if (showSubtitles && alignedWords.length > 0) {
      setBurnProgress(0);
      try {
        const { burnSubtitles } = await import('../utils/subtitleBurner');
        const burnedBlob = await burnSubtitles({
          videoBlob: rawBlob,
          words: alignedWords,
          onProgress: (pct) => setBurnProgress(pct),
        });
        const url = URL.createObjectURL(burnedBlob);
        const isWebM = burnedBlob.type.includes('webm');
        const ext = isWebM ? 'webm' : 'mp4';
        const a = document.createElement('a');
        a.href = url;
        a.download = `SpeakGarden_Karaoke_${qualityLabel}_${timeString}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Subtitle burning failed, downloading raw video:', err);
        // Fallback to raw download if burn fails
        const a = document.createElement('a');
        a.href = rawUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        setBurnProgress(null);
      }
    } else {
      // Subtitles disabled/missing: download raw video instantly
      const a = document.createElement('a');
      a.href = rawUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Trigger lyrics alignment pipeline (lazy-loads model on first use)
  const triggerLyricsAlignment = async (blob: Blob) => {
    if (!lyricsText.trim()) return;
    setIsSyncing(true);
    setSyncError(null);
    setSyncStatus('Extracting audio…');
    try {
      const { extractAudio, computeVAD } = await import('../utils/audioProcessor');
      const { alignLyrics } = await import('../utils/lyricsAligner');
      const audio = await extractAudio(blob);
      const vadFrames = computeVAD(audio);
      const { words, confidence } = await alignLyrics(audio, lyricsText, vadFrames, (status) => {
        setSyncStatus(status);
      });
      setAlignedWords(words);
      setShowSubtitles(true);

      // Low confidence alert (soft warning instead of hard blocking error)
      const dynamicThreshold = lyricsText.trim().split(/\s+/).length > 25 ? 0.18 : 0.35;
      if (confidence < dynamicThreshold) {
        setSyncError(
          `AI Sync confidence agak rendah (${Math.round(confidence * 100)}%). ` +
          'Beberapa kata mungkin perlu digeser/disesuaikan secara manual.'
        );
      }
    } catch (err: any) {
      console.error('Lyrics alignment failed:', err);
      setSyncError('Sync gagal. Periksa koneksi internet atau coba manual adjust.');
    } finally {
      setIsSyncing(false);
    }
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

            {/* Overlay: Active Review Overlay with Karaoke Subtitle */}
            {recordingState === 'review' && (recordedUrlHD || recordedUrlSD) && (
              <div className="absolute inset-0 bg-black z-30 flex items-center justify-center">
                <video 
                  ref={reviewVideoRef}
                  key={recordedUrlHD || recordedUrlSD || 'review'}
                  src={recordedUrlHD || recordedUrlSD || undefined} 
                  controls 
                  className="w-full h-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setReviewCurrentTime(t);
                    if (timelineScrollRef.current && !isScrubbingRef.current) {
                      const container = timelineScrollRef.current;
                      const pxPerSec = 90;
                      const center = container.clientWidth / 2;
                      container.scrollLeft = (t * pxPerSec) - center;
                    }
                  }}
                  onLoadedData={(e) => {
                    const vid = e.currentTarget;
                    vid.play().catch(() => {});
                    setTimeout(() => { vid.muted = false; }, 300);
                  }}
                />
                {/* Karaoke subtitle overlay — bottom center, no background */}
                {showSubtitles && alignedWords.length > 0 && (() => {
                  const t = reviewCurrentTime;
                  const windowStart = Math.max(0, alignedWords.findIndex(w => w.end > t) - 1);
                  const windowWords = alignedWords.slice(windowStart, windowStart + 6);
                  
                  // Group into rows of max 3 words
                  const rows: typeof windowWords[] = [];
                  for (let i = 0; i < windowWords.length; i += 3) {
                    rows.push(windowWords.slice(i, i + 3));
                  }

                  return rows.length > 0 ? (
                    <div
                      className="absolute left-0 right-0 flex flex-col gap-0.5 justify-center items-center pointer-events-none z-40"
                      style={{ bottom: '15%' }}
                    >
                      {rows.map((row, rIdx) => (
                        <div key={rIdx} className="flex gap-2 justify-center">
                          {row.map((w, i) => {
                            const isActive = t >= w.start && t < w.end;
                            return (
                              <span
                                key={`${w.word}-${i}`}
                                style={{
                                  textShadow: '0 1px 6px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)',
                                  transition: 'all 0.1s ease',
                                  display: 'inline-block',
                                  fontSize: isActive ? '1.125rem' : '1rem',
                                  fontWeight: 700,
                                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.6)',
                                  transform: isActive ? 'scale(1.1)' : 'scale(1)',
                                }}
                              >
                                {w.word}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
                {/* Syncing spinner overlay */}
                {isSyncing && (
                  <div className="absolute inset-0 bg-black/70 z-50 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <p className="text-white text-sm font-semibold">{syncStatus}</p>
                  </div>
                )}
              </div>
            )}

            {/* Teleprompter overlay while recording */}
            {isTeleprompter && lyricsText.trim() && (recordingState === 'recording' || recordingState === 'paused') && (
              <div 
                className="absolute left-4 right-4 top-[15%] h-[150px] z-30 bg-black/75 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden pointer-events-none flex flex-col justify-start"
                style={{
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent, white 25%, white 75%, transparent)',
                  maskImage: 'linear-gradient(to bottom, transparent, white 25%, white 75%, transparent)',
                }}
              >
                {/* Scrolling container */}
                <div
                  className="w-full text-center px-4"
                  style={{
                    transform: `translateY(${75 - (recordingTime * teleprompterSpeed)}px)`,
                    transition: recordingState === 'recording' ? 'transform 1s linear' : 'none',
                  }}
                >
                  {lyricsText.split('\n').map((line, i) => (
                    <div 
                      key={i} 
                      className="text-white text-base font-semibold leading-loose tracking-wide opacity-90 py-0.5"
                    >
                      {line.trim() || '\u00A0'}
                    </div>
                  ))}
                </div>

                {/* Horizontal focal center guide line */}
                <div className="absolute top-[75px] left-4 right-4 h-[1px] bg-indigo-500/20 border-t border-dashed border-indigo-400/40 pointer-events-none" />
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

          {/* Visual Subtitle Timeline Editor (CapCut Style) */}
          {recordingState === 'review' && alignedWords.length > 0 && (() => {
            const duration = reviewVideoRef.current?.duration || recordingTime || 10;
            const pxPerSec = 90; // zoom scale
            const timelineWidth = duration * pxPerSec;

            // Generate ticks
            const ticks: number[] = [];
            for (let sec = 0; sec <= Math.ceil(duration); sec++) ticks.push(sec);

            return (
              <div className="w-full glass-panel overflow-hidden z-20 relative select-none">
                {/* Header bar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/50">
                  <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                    Subtitle Timeline
                  </span>
                  <span className="text-[10px] font-mono text-slate-600 font-bold">
                    {String(Math.floor(reviewCurrentTime / 60)).padStart(2,'0')}:{(reviewCurrentTime % 60).toFixed(2).padStart(5,'0')}
                    <span className="text-slate-300 mx-1">/</span>
                    {String(Math.floor(duration / 60)).padStart(2,'0')}:{(duration % 60).toFixed(2).padStart(5,'0')}
                  </span>
                </div>

                {/* Timeline viewport — overflow hidden, scrubbing via wheel or drag on background */}
                <div
                  className="relative overflow-hidden bg-[#111827] cursor-ew-resize"
                  style={{ height: '96px' }}
                  onWheel={(e) => {
                    e.preventDefault();
                    const duration = reviewVideoRef.current?.duration || recordingTime || 10;
                    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                    const newTime = Math.max(0, Math.min(
                      (reviewVideoRef.current?.currentTime ?? reviewCurrentTime) + delta / 90,
                      duration
                    ));
                    if (reviewVideoRef.current) reviewVideoRef.current.currentTime = newTime;
                    setReviewCurrentTime(newTime);
                  }}
                  onPointerDown={(e) => {
                    // Only start scrub if NOT clicking on a clip (clips call stopPropagation)
                    isScrubbingRef.current = true;
                    scrubStartXRef.current = e.clientX;
                    scrubStartTimeRef.current = reviewVideoRef.current?.currentTime ?? reviewCurrentTime;
                    if (reviewVideoRef.current && !reviewVideoRef.current.paused) {
                      reviewVideoRef.current.pause();
                    }
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!isScrubbingRef.current || dragState) return;
                    const duration = reviewVideoRef.current?.duration || recordingTime || 10;
                    const deltaX = scrubStartXRef.current - e.clientX;
                    const newTime = Math.max(0, Math.min(
                      scrubStartTimeRef.current + deltaX / 90,
                      duration
                    ));
                    if (reviewVideoRef.current) reviewVideoRef.current.currentTime = newTime;
                    setReviewCurrentTime(newTime);
                  }}
                  onPointerUp={() => { isScrubbingRef.current = false; }}
                  onPointerLeave={() => { isScrubbingRef.current = false; }}
                >
                  {/* Inner translating track */}
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `calc(50% - ${reviewCurrentTime * pxPerSec}px)`,
                      width: `${timelineWidth}px`,
                      transition: (dragState || isScrubbingRef.current) ? 'none' : 'left 0.08s linear',
                    }}
                    onPointerMove={handleTimelinePointerMove}
                    onPointerUp={handleTimelinePointerUp}
                    onPointerLeave={handleTimelinePointerUp}
                  >
                    {/* Time ruler */}
                    <div className="absolute top-0 left-0 w-full h-6 border-b border-white/5 pointer-events-none">
                      {ticks.map((sec) => (
                        <div
                          key={sec}
                          className="absolute bottom-0 flex flex-col items-center"
                          style={{ left: `${sec * pxPerSec}px` }}
                        >
                          <span className="text-[8px] font-mono text-white/30 mb-0.5 -translate-x-1/2 select-none">
                            {String(Math.floor(sec / 60)).padStart(2,'0')}:{String(sec % 60).padStart(2,'0')}
                          </span>
                          <div className="w-px h-1.5 bg-white/10" />
                        </div>
                      ))}
                    </div>

                    {/* Clip track */}
                    <div className="absolute left-0 w-full" style={{ top: '26px', height: '48px' }}>
                      {alignedWords.map((w, idx) => {
                        const left   = w.start * pxPerSec;
                        const width  = Math.max((w.end - w.start) * pxPerSec, 18);
                        const isSelected = selectedWordIndex === idx;
                        const isPlaying  = reviewCurrentTime >= w.start && reviewCurrentTime < w.end;

                        return (
                          <div
                            key={idx}
                            data-clip="true"
                            onPointerDown={(e) => handleTimelinePointerDown(e, idx, 'move')}
                            onClick={(e) => { e.stopPropagation(); setSelectedWordIndex(idx); }}
                            className="absolute flex items-stretch cursor-grab pointer-events-auto overflow-hidden"
                            style={{
                              left:  `${left}px`,
                              width: `${width}px`,
                              height: '38px',
                              top:   '5px',
                              borderRadius: '6px',
                              backgroundColor: isSelected ? '#f97316' : isPlaying ? '#6366f1' : '#374151',
                              outline: isSelected ? '2px solid rgba(255,255,255,0.6)' : isPlaying ? '1.5px solid #818cf8' : 'none',
                            }}
                          >
                            {/* Left handle */}
                            <div
                              onPointerDown={(e) => handleTimelinePointerDown(e, idx, 'resize-start')}
                              className="flex-shrink-0 flex items-center justify-center cursor-col-resize pointer-events-auto"
                              style={{
                                width: isSelected ? '14px' : '5px',
                                background: isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)',
                                borderRadius: '6px 0 0 6px',
                              }}
                            >
                              {isSelected && (
                                <div className="flex gap-[2px]">
                                  <div style={{ width:'1.5px', height:'10px', background:'#374151', borderRadius:'1px' }} />
                                  <div style={{ width:'1.5px', height:'10px', background:'#374151', borderRadius:'1px' }} />
                                </div>
                              )}
                            </div>

                            {/* Label */}
                            <span className="flex-1 flex items-center justify-center text-white font-semibold truncate select-none"
                              style={{ fontSize: '10px', padding: '0 3px' }}>
                              {w.word}
                            </span>

                            {/* Right handle */}
                            <div
                              onPointerDown={(e) => handleTimelinePointerDown(e, idx, 'resize-end')}
                              className="flex-shrink-0 flex items-center justify-center cursor-col-resize pointer-events-auto"
                              style={{
                                width: isSelected ? '14px' : '5px',
                                background: isSelected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)',
                                borderRadius: '0 6px 6px 0',
                              }}
                            >
                              {isSelected && (
                                <div className="flex gap-[2px]">
                                  <div style={{ width:'1.5px', height:'10px', background:'#374151', borderRadius:'1px' }} />
                                  <div style={{ width:'1.5px', height:'10px', background:'#374151', borderRadius:'1px' }} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fixed playhead at center */}
                  <div className="absolute top-0 bottom-0 pointer-events-none z-20"
                    style={{ left: '50%', transform: 'translateX(-50%)' }}>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2"
                      style={{ width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'8px solid #ef4444' }} />
                    <div className="absolute top-2 bottom-0 left-1/2 -translate-x-1/2 w-[1.5px] bg-red-500" />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Action Recorder Console & Review buttons Card */}
          <div className="glass-panel p-5 w-full max-w-full overflow-hidden flex flex-col gap-4 items-center justify-center relative z-20">
            {/* Control buttons row */}
            <div className="flex items-center justify-center w-full min-h-[64px]">
              {recordingState === 'review' && (() => {
                return (
                  <div className="flex flex-col gap-2 w-full">
                    {/* Main action row: Retake | Download | Subtitle icon */}
                    <div className="flex items-center gap-2.5 w-full">
                      {/* Retake */}
                      <button
                        onClick={handleRetake}
                        className="flex-1 h-12 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                        Retake
                      </button>

                      {/* Download split button: [Download MP4] [HD/SD pill] */}
                      <div className="flex-1 h-12 flex rounded-xl overflow-hidden shadow-md">
                        <button
                          onClick={() => handleDownload(isHD ? 'hd' : 'sd')}
                          disabled={burnProgress !== null}
                          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
                          className="flex-1 h-full hover:opacity-90 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-80"
                        >
                          {burnProgress !== null ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                              Burning {burnProgress}%
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5 text-white" />
                              Download MP4
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setIsHD(v => !v)}
                          disabled={burnProgress !== null}
                          title={isHD ? 'Currently HD — click for SD' : 'Currently SD — click for HD'}
                          style={{ backgroundColor: isHD ? '#4338ca' : '#475569' }}
                          className="px-3 h-full text-[10px] font-black tracking-wide text-white transition flex items-center border-l border-white/10 disabled:opacity-80"
                        >
                          {isHD ? 'HD' : 'SD'}
                        </button>
                      </div>

                      {/* Subtitle toggle icon */}
                      {lyricsText.trim() && (
                        <button
                          type="button"
                          onClick={() => setShowSubtitles(v => !v)}
                          title={showSubtitles ? 'Hide subtitles' : 'Show subtitles'}
                          className={`w-12 h-12 rounded-xl border flex items-center justify-center flex-shrink-0 transition ${
                            showSubtitles
                              ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                              : 'border-slate-200 bg-white text-slate-400'
                          }`}
                        >
                          {showSubtitles
                            ? <Eye className="w-4.5 h-4.5" />
                            : <EyeOff className="w-4.5 h-4.5" />
                          }
                        </button>
                      )}
                    </div>

                    {/* Syncing status */}
                    {isSyncing && (
                      <div className="flex items-center justify-center gap-2 py-0.5">
                        <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                        <span className="text-[11px] text-indigo-400 font-medium">{syncStatus}</span>
                      </div>
                    )}

                    {/* Mismatch / sync error banner */}
                    {syncError && !isSyncing && (
                      <div className="w-full px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
                        <span className="text-rose-500 text-sm leading-none mt-0.5">⚠️</span>
                        <p className="text-xs text-rose-700 font-semibold leading-snug flex-1">{syncError}</p>
                        <button type="button" onClick={() => setSyncError(null)} className="text-rose-300 hover:text-rose-500 text-xs transition">✕</button>
                      </div>
                    )}
                  </div>
                );
              })()}


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

            {/* Camera Filters Carousel - page-based, no overflow scroll needed */}
            {recordingState === 'idle' && (() => {
              const ITEMS_PER_PAGE = 4;
              const totalPages = Math.ceil(CAMERA_FILTERS.length / ITEMS_PER_PAGE);
              const pageFilters = CAMERA_FILTERS.slice(filterPage * ITEMS_PER_PAGE, (filterPage + 1) * ITEMS_PER_PAGE);
              return (
                <div className="w-full border-t border-slate-100 pt-3 flex flex-col gap-2">
                  {/* Header row */}
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] text-slate-400 font-extrabold tracking-widest uppercase select-none">
                      Camera Filters & Effects
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 font-medium">
                        {filterPage + 1}/{totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFilterPage(p => Math.max(0, p - 1))}
                        disabled={filterPage === 0}
                        className="w-7 h-7 rounded-full bg-indigo-50 hover:bg-indigo-100 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-600 flex items-center justify-center transition border border-indigo-200 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={filterPage >= totalPages - 1}
                        className="w-7 h-7 rounded-full bg-indigo-50 hover:bg-indigo-100 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-600 flex items-center justify-center transition border border-indigo-200 cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Filter pills - 1 row, equal width flex */}
                  <div className="flex flex-row gap-1.5 w-full">
                    {pageFilters.map((f) => {
                      const active = cameraFilter === f.value;
                      const Icon = f.icon;
                      return (
                        <button
                          key={f.value}
                          type="button"
                          onClick={() => setCameraFilter(f.value)}
                          style={{ 
                            flex: '1 1 0',
                            background: active ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' : '#ffffff',
                            borderColor: active ? 'transparent' : '#e2e8f0'
                          }}
                          className={`h-14 rounded-xl border text-[10px] font-bold flex flex-col items-center justify-center gap-1 transition-all duration-200 active:scale-95 ${
                            active
                              ? 'shadow-md shadow-indigo-400/30'
                              : 'hover:bg-slate-50 hover:border-indigo-200'
                          }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-white' : 'text-slate-500'}`} />
                          <span className={`leading-none text-center ${active ? 'text-white' : 'text-slate-650'}`}>{f.label}</span>
                        </button>
                      );
                    })}
                    {/* Pad remaining slots to keep layout stable */}
                    {Array.from({ length: ITEMS_PER_PAGE - pageFilters.length }).map((_, i) => (
                      <div key={`pad-${i}`} style={{ flex: '1 1 0' }} />
                    ))}
                  </div>

                  {/* Dot indicators */}
                  <div className="flex justify-center gap-1.5 pt-0.5">
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setFilterPage(i)}
                        className={`rounded-full transition-all duration-200 ${
                          i === filterPage
                            ? 'w-4 h-1.5 bg-indigo-500'
                            : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
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

          {/* Card: Lyrics / Teleprompter */}
          <div className="glass-panel p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Type className="w-4 h-4 text-indigo-500" />
                Lyrics & Auto-Sync
              </h2>
              <button
                type="button"
                onClick={() => setIsTeleprompter(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition border ${
                  isTeleprompter
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                }`}
              >
                <Eye className="w-3 h-3" />
                Teleprompter
              </button>
            </div>
            <textarea
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              placeholder={`Paste your lyrics here…\n\nAfter recording, the AI will automatically sync each word with your audio.`}
              rows={5}
              className="w-full text-xs px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:border-indigo-400 outline-none text-slate-800 leading-relaxed resize-none transition placeholder:text-slate-300"
            />
             {lyricsText.trim() && (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                ✨ <strong>{lyricsText.trim().split(/\s+/).length} words</strong> detected.
              </p>
            )}

            {isTeleprompter && lyricsText.trim() && (
              <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-400 font-extrabold tracking-wider uppercase">
                    Teleprompter Speed
                  </span>
                  <span className="text-[10px] font-mono text-indigo-650 bg-indigo-50 px-1.5 py-0.5 rounded font-black">
                    {teleprompterSpeed} px/s
                  </span>
                </div>
                <input 
                  type="range"
                  min={10}
                  max={60}
                  step={2}
                  value={teleprompterSpeed}
                  onChange={(e) => setTeleprompterSpeed(Number(e.target.value))}
                  className="w-full h-1 bg-slate-250 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <span className="text-[9px] text-slate-400 leading-normal">
                  Adjust to match your singing/reading tempo (Slow 15 - Fast 45).
                </span>
              </div>
            )}
            {recordingState === 'review' && recordedBlobHD && lyricsText.trim() && (
              <button
                type="button"
                onClick={() => triggerLyricsAlignment(recordedBlobHD)}
                disabled={isSyncing}
                className="w-full py-2 px-3 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 text-indigo-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {alignedWords.length > 0 ? 'Re-sync / Re-transcribe Lyrics' : 'Sync Lyrics Now'}
              </button>
            )}

            {alignedWords.length > 0 && !isSyncing && (() => {
              // 1. Calculate active frame words (matching what is currently visible on screen)
              const t = reviewCurrentTime;
              const windowStart = Math.max(0, alignedWords.findIndex(w => w.end > t) - 1);
              const windowWords = alignedWords.slice(windowStart, windowStart + 6);
              
              const activeWordIdxInWindow = windowWords.findIndex(w => t >= w.start && t < w.end);
              const useSecondHalf = activeWordIdxInWindow >= 3;
              const startOffset = useSecondHalf ? 3 : 0;
              const activeFrameWords = windowWords.slice(startOffset, startOffset + 3).map(w => {
                const originalIndex = alignedWords.findIndex(orig => orig.start === w.start && orig.word === w.word);
                return { ...w, originalIndex };
              }).filter(item => item.originalIndex !== -1);

              // 2. Automatically resolve currently edited word (default to active playing word in frame)
              const playingWord = activeFrameWords.find(w => t >= w.start && t < w.end);
              const currentEditIdx = selectedWordIndex !== null && activeFrameWords.some(w => w.originalIndex === selectedWordIndex)
                ? selectedWordIndex
                : (playingWord ? playingWord.originalIndex : (activeFrameWords.length > 0 ? activeFrameWords[0].originalIndex : null));

              return (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs text-emerald-700 font-semibold">
                      {alignedWords.length} words synced ✓
                    </span>
                  </div>

                  {/* Dynamic frame-words view */}
                  {activeFrameWords.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Words in Current Frame
                      </span>
                      <div className="flex gap-2 p-2 border border-slate-100 rounded-xl bg-slate-50/50 justify-center">
                        {activeFrameWords.map((w) => {
                          const isSelected = currentEditIdx === w.originalIndex;
                          const isPlaying = t >= w.start && t < w.end;
                          return (
                            <button
                              key={w.originalIndex}
                              type="button"
                              onClick={() => handleWordClick(w.originalIndex)}
                              style={{ transition: 'all 0.15s ease' }}
                              className={`text-xs px-3 py-1.5 rounded-lg border font-semibold flex-1 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-600 border-indigo-650 text-white font-bold shadow-sm'
                                  : isPlaying
                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-bold ring-2 ring-indigo-500/10'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-650'
                              }`}
                            >
                              {w.word}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Micro Adjusters for selected word */}
                  {currentEditIdx !== null && alignedWords[currentEditIdx] && (() => {
                    const w = alignedWords[currentEditIdx];
                    return (
                      <div className="p-3 bg-indigo-50/30 border border-indigo-100 rounded-xl flex flex-col gap-2.5">
                        <div className="flex items-center justify-between border-b border-indigo-100/50 pb-1.5">
                          <span className="text-xs font-bold text-indigo-950">
                            Editing: "{w.word}"
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {w.start.toFixed(2)}s - {w.end.toFixed(2)}s
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          {/* Start time adjustment */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] text-slate-400 font-bold uppercase">Start Time</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => adjustWordTime(currentEditIdx, 'start', -0.05)}
                                className="flex-1 py-1 px-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-black text-slate-650 transition cursor-pointer"
                              >
                                -0.05
                              </button>
                              <button
                                type="button"
                                onClick={() => adjustWordTime(currentEditIdx, 'start', 0.05)}
                                className="flex-1 py-1 px-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-black text-slate-650 transition cursor-pointer"
                              >
                                +0.05
                              </button>
                            </div>
                          </div>

                          {/* End time adjustment */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] text-slate-400 font-bold uppercase">End Time</span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => adjustWordTime(currentEditIdx, 'end', -0.05)}
                                className="flex-1 py-1 px-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-black text-slate-650 transition cursor-pointer"
                              >
                                -0.05
                              </button>
                              <button
                                type="button"
                                onClick={() => adjustWordTime(currentEditIdx, 'end', 0.05)}
                                className="flex-1 py-1 px-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-black text-slate-650 transition cursor-pointer"
                              >
                                +0.05
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>

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
