'use client';

import React, { useEffect, useRef, useState } from 'react';
import { 
  Camera, Mic, Settings, Download, RotateCcw, Play, Pause, Square, 
  Sparkles, Trash2, Video, Volume2, Monitor, RefreshCw, LayoutGrid
} from 'lucide-react';
import { useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { drawBackground, drawCartoonBody, draw2DAvatar, AvatarType, BackgroundType, FaceData } from '../utils/avatarRenderer';
import { ThreeAvatarRenderer } from '../utils/threeAvatarRenderer';

type AspectRatio = '9:16' | '1:1' | '16:9' | '4:3';

const ASPECT_RATIOS: Record<AspectRatio, { width: number; height: number; label: string; ratio: number }> = {
  '9:16': { width: 720, height: 1280, label: '9:16 (Portrait)', ratio: 9/16 },
  '1:1': { width: 720, height: 720, label: '1:1 (Square)', ratio: 1 },
  '16:9': { width: 1280, height: 720, label: '16:9 (Landscape)', ratio: 16/9 },
  '4:3': { width: 960, height: 720, label: '4:3 (Classic)', ratio: 4/3 },
};

const DEFAULT_3D_AVATARS = [
  { name: 'Cute Anime', url: 'https://models.readyplayer.me/64b025a12b7a42145e69e02c.glb' },
  { name: 'Casual Guy', url: 'https://models.readyplayer.me/65646d0a7905f884fc5bdecc.glb' }
];

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
  const [avatarMode, setAvatarMode] = useState<'2d' | '3d'>('2d');
  const [backgroundType, setBackgroundType] = useState<BackgroundType>('camera');
  
  // 3. 3D Avatar States
  const [custom3DUrl, setCustom3DUrl] = useState<string>('');
  const [active3DUrl, setActive3DUrl] = useState<string>(DEFAULT_3D_AVATARS[0].url);
  const [threeLoaderProgress, setThreeLoaderProgress] = useState<number>(0);
  const [isThreeModelLoading, setIsThreeModelLoading] = useState<boolean>(false);
  const [threeError, setThreeError] = useState<string | null>(null);

  // 4. Recording & Review States
  const [recordingState, setRecordingState] = useState<'idle' | 'countdown' | 'recording' | 'paused' | 'review'>('idle');
  const [countdown, setCountdown] = useState<number>(3);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);


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
  const canvas3DRef = useRef<HTMLCanvasElement>(null);
  const threeRendererRef = useRef<ThreeAvatarRenderer | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
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

  // Initialize and update 3D Avatar Renderer
  useEffect(() => {
    const canvas3D = canvas3DRef.current;
    if (!canvas3D) return;

    // Initialize 3D renderer if not present
    if (!threeRendererRef.current) {
      threeRendererRef.current = new ThreeAvatarRenderer(canvas3D);
    }

    const targetSize = ASPECT_RATIOS[aspectRatio];
    threeRendererRef.current.resize(targetSize.width, targetSize.height);

    // Load active model if needed
    if (avatarMode === '3d' && avatarType !== 'none') {
      setIsThreeModelLoading(true);
      setThreeError(null);
      threeRendererRef.current.loadAvatar(active3DUrl, (pct) => {
        setThreeLoaderProgress(Math.round(pct));
      })
      .then(() => {
        setIsThreeModelLoading(false);
      })
      .catch((err) => {
        setIsThreeModelLoading(false);
        setThreeError('Could not load 3D model. Make sure it is a valid public GLB URL.');
      });
    }

    return () => {
      // Don't fully destroy renderer on aspect ratio change, just resize it
    };
  }, [aspectRatio, avatarMode, avatarType, active3DUrl]);

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

                  if (eyeL && eyeR && forehead && chin) {
                    const cx = ((1 - eyeL.x) + (1 - eyeR.x)) / 2 * targetSize.width;
                    const cy = ((forehead.y + chin.y) / 2) * targetSize.height;
                    const facePixelHeight = (chin.y - forehead.y) * targetSize.height;
                    const scaleVal = (facePixelHeight / 2) / 85;

                    let rollAngle = 0;
                    {
                      const lx = (1 - eyeL.x) * targetSize.width;
                      const ly = eyeL.y * targetSize.height;
                      const rx = (1 - eyeR.x) * targetSize.width;
                      const ry = eyeR.y * targetSize.height;
                      rollAngle = Math.atan2(ly - ry, lx - rx);
                    }

                    const bsMap: Record<string, number> = {};
                    blendshapes.forEach(b => { bsMap[b.categoryName] = b.score; });

                    faceData = {
                      cx,
                      cy,
                      scale: scaleVal,
                      rotation: rollAngle,
                      isLeftEyeOpen: (bsMap['eyeBlinkLeft'] || 0) < 0.35,
                      isRightEyeOpen: (bsMap['eyeBlinkRight'] || 0) < 0.35,
                      mouthOpenRatio: bsMap['jawOpen'] || 0,
                      smileIntensity: ((bsMap['mouthSmileLeft'] || 0) + (bsMap['mouthSmileRight'] || 0)) / 2
                    };
                  }

                  if (avatarMode === '3d' && avatarType !== 'none' && threeRendererRef.current) {
                    threeRendererRef.current.updateBackgroundTexture(canvas2D);
                    threeRendererRef.current.update(landmarks, blendshapes);
                  }
                } else {
                  if (avatarMode === '3d' && avatarType !== 'none' && threeRendererRef.current) {
                    threeRendererRef.current.updateBackgroundTexture(canvas2D);
                    threeRendererRef.current.update([], []);
                  }
                }
              } catch (_) {
                // Silently handle detection glitches
              }
            }
          }

          // 4. Render 2D Cartoon Avatar elements if active
          if (avatarMode === '2d' && avatarType !== 'none') {
            if (faceData) {
              // Only draw cartoon body if virtual background is active
              if (backgroundType !== 'camera') {
                drawCartoonBody(ctx2D, faceData.cx, faceData.cy, faceData.scale, avatarType);
              }
              // Draw face
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
  }, [aspectRatio, avatarType, avatarMode, backgroundType]);

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

  // Start recording actual media
  const startRecording = () => {
    if (!stream) return;
    
    recordedChunksRef.current = [];
    
    // Choose active canvas stream based on avatar selection
    const recordCanvas = (avatarMode === '3d' && avatarType !== 'none') 
      ? canvas3DRef.current 
      : canvas2DRef.current;
      
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

      // 3. Assemble composite stream
      const compositeStream = new MediaStream();
      if (videoTrack) compositeStream.addTrack(videoTrack);
      if (audioTrack) compositeStream.addTrack(audioTrack);

      // 4. Find supported mimeType
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;
      console.log('Initializing MediaRecorder with mimeType:', mimeType || 'default', 'options:', options);
      
      const mediaRecorder = new MediaRecorder(compositeStream, options);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log('MediaRecorder chunk received, size:', event.data.size, 'type:', event.data.type);
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (err) => {
        console.error('MediaRecorder runtime error:', err);
      };

      mediaRecorder.onstop = () => {
        const actualType = mediaRecorder.mimeType || mimeType || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type: actualType });
        console.log('MediaRecorder stopped. Total chunks:', recordedChunksRef.current.length, 'Blob size:', blob.size, 'MIME:', actualType);
        
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordingStateSynced('review');
        
        // Stop canvas capture stream track to release memory
        if (videoTrack) {
          try {
            videoTrack.stop();
            console.log('Canvas capture video track stopped.');
          } catch (e) {
            console.error('Error stopping video track:', e);
          }
        }

        // Clear active recording timer
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      
      // Start recording. Calling start() without timeslice forces the browser to
      // package the recording reliably into a single high-quality chunk upon stop().
      mediaRecorder.start(); 
      console.log('MediaRecorder started successfully.');

      setRecordingStateSynced('recording');
      setRecordingTime(0);

      // Start elapsed timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (e) {
      console.error('Failed to start recording:', e);
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
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.pause();
      setRecordingStateSynced('paused');
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    }
  };

  // Resume recording
  const resumeRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'paused') {
      mediaRecorderRef.current.resume();
      setRecordingStateSynced('recording');
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.requestData();
      } catch (e) {}
      mediaRecorderRef.current.stop();
    }
  };

  // Retake recording
  const handleRetake = () => {
    // Move to idle first so the canvas loop restarts before revoking the URL
    setRecordingStateSynced('idle');
    setRecordingTime(0);
    // Revoke URL after a short delay so the video element finishes unloading
    setTimeout(() => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
      setRecordedUrl(null);
    }, 100);
  };

  // Download recorded video (force MP4 container output file)
  const handleDownload = () => {
    if (!recordedUrl) return;

    const timeString = new Date().toISOString().split('T')[0];
    const fileName = `SpeakGarden_${aspectRatio.replace(':', 'x')}_${timeString}.mp4`;
    
    const a = document.createElement('a');
    a.href = recordedUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Helper formatting seconds to MM:SS
  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle custom Ready Player Me URL loading
  const handleLoadCustom3D = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custom3DUrl.trim()) return;
    
    // Convert short/regular Ready Player Me subdomain URLs to raw .glb endpoint
    // E.g. https://readyplayer.me/avatar-editor?id=64b025a12... -> models link
    let formattedUrl = custom3DUrl.trim();
    if (formattedUrl.includes('readyplayer.me') && !formattedUrl.endsWith('.glb')) {
      // Try to extract avatar ID
      const urlObj = new URL(formattedUrl);
      const avatarId = urlObj.searchParams.get('id') || urlObj.pathname.split('/').pop();
      if (avatarId && avatarId.length > 10) {
        formattedUrl = `https://models.readyplayer.me/${avatarId}.glb`;
      }
    }

    setActive3DUrl(formattedUrl);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-6xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl shadow-lg shadow-indigo-500/25">
            <Video className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-purple-300">
              FaceCraft Recorder
            </h1>
            <p className="text-xs text-var(--color-text-muted)">
              Create portrait videos with custom dimensions and cartoon animal filters
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
          {isThreeModelLoading && (
            <div className="flex items-center gap-2 text-purple-400 bg-purple-500/10 px-3 py-1.5 rounded-full border border-purple-500/20">
              <RefreshCw className="w-4.5 h-4.5 animate-spin" />
              <span>Loading 3D Avatar ({threeLoaderProgress}%)</span>
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
            className="w-full relative glass-panel overflow-hidden flex items-center justify-center border-indigo-500/20 transition-all duration-300"
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
              style={{ display: (recordingState === 'review' || (avatarMode === '3d' && avatarType !== 'none')) ? 'none' : 'block' }}
            />

            {/* Canvas 3D (WebGL Three.js rendering) */}
            <canvas 
              ref={canvas3DRef}
              className="w-full h-full object-contain"
              style={{ display: (recordingState !== 'review' && avatarMode === '3d' && avatarType !== 'none') ? 'block' : 'none' }}
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
            {recordingState === 'review' && recordedUrl && (
              <div className="absolute inset-0 bg-black z-30 flex items-center justify-center">
                <video 
                  key={recordedUrl}
                  src={recordedUrl} 
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
          <div className="glass-panel p-5 w-full flex items-center justify-center min-h-[96px]">
            {recordingState === 'review' && (
              <div className="flex gap-4 w-full justify-center max-w-sm">
                <button 
                  onClick={handleRetake}
                  className="flex-1 py-3 px-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 shadow transition"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                  Retake
                </button>
                <button 
                  onClick={handleDownload}
                  className="flex-1 py-3 px-5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:opacity-90 active:scale-98 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 transition"
                >
                  <Download className="w-4 h-4" />
                  Download MP4
                </button>
              </div>
            )}

            {recordingState === 'idle' && (
              <button
                onClick={initiateRecording}
                disabled={isLandmarkerLoading || (avatarMode === '3d' && isThreeModelLoading)}
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
              
              {/* 2D / 3D Mode Toggle */}
              {avatarType !== 'none' && (
                <div className="flex rounded-lg bg-slate-200 p-0.5 border border-slate-300 text-[10px] font-bold uppercase tracking-wider">
                  <button
                    onClick={() => setAvatarMode('2d')}
                    className={`px-3 py-1 rounded-md transition ${avatarMode === '2d' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    2D Animals
                  </button>
                  <button
                    onClick={() => setAvatarMode('3d')}
                    className={`px-3 py-1 rounded-md transition ${avatarMode === '3d' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    3D Human
                  </button>
                </div>
              )}
            </div>

            {/* List of filters */}
            {avatarMode === '2d' || avatarType === 'none' ? (
              <div className="grid grid-cols-3 gap-2">
                {(['none', 'bear', 'cat', 'panda', 'dog', 'rabbit'] as AvatarType[]).map((type) => {
                  const active = avatarType === type;
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        setAvatarType(type);
                        setAvatarMode('2d');
                      }}
                      className={`py-3.5 px-2.5 rounded-xl border text-center flex flex-col items-center gap-2 uppercase tracking-wide text-[10px] font-semibold transition ${
                        active 
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
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
            ) : (
              // 3D Avatar Selector Panel
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2">
                  {DEFAULT_3D_AVATARS.map((avatar) => {
                    const active = active3DUrl === avatar.url;
                    return (
                      <button
                        key={avatar.name}
                        onClick={() => {
                          setAvatarType('bear'); // Trigger avatar state active (not raw)
                          setAvatarMode('3d');
                          setActive3DUrl(avatar.url);
                        }}
                        className={`py-3.5 px-2.5 rounded-xl border text-center flex flex-col items-center gap-1.5 transition ${
                          active 
                            ? 'border-indigo-500 bg-indigo-550 text-white shadow-md' 
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span className="text-2xl">🤖</span>
                        <span className="text-[10px] font-semibold uppercase">{avatar.name}</span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Paste Ready Player Me .glb URL */}
                <form onSubmit={handleLoadCustom3D} className="flex flex-col gap-2">
                  <label className="text-[10px] text-slate-400 uppercase font-semibold">
                    Paste custom Ready Player Me GLB URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://models.readyplayer.me/avatar.glb"
                      value={custom3DUrl}
                      onChange={(e) => setCustom3DUrl(e.target.value)}
                      className="flex-1 text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-slate-800 transition"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-white font-medium text-xs rounded-xl shadow transition"
                    >
                      Load
                    </button>
                  </div>
                  {threeError && <p className="text-[10px] text-rose-400 mt-1">{threeError}</p>}
                </form>
              </div>
            )}
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
