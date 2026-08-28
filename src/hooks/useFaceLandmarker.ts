import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export function useFaceLandmarker() {
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (landmarkerRef.current) {
        setIsLoading(false);
        setReady(true);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        if (cancelled) return;

        // Try GPU first, fall back to CPU if GPU fails (common on macOS WebGL)
        let landmarker: FaceLandmarker | null = null;
        
        try {
          landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
              delegate: 'GPU',
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
          });
        } catch (gpuErr) {
          console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
          landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
              delegate: 'CPU',
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
          });
        }

        if (cancelled) {
          try { landmarker.close(); } catch (_) {}
          return;
        }

        landmarkerRef.current = landmarker;
        setReady(true);
        setIsLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to initialize FaceLandmarker:', err);
          setError(err?.message || 'Failed to load face tracking model');
          setIsLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  return { landmarkerRef, isLoading, error, ready };
}
