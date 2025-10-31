import { Injectable } from '@angular/core';
import * as faceapi from 'face-api.js';

/**
 * FaceDetectionService
 * - Tập trung mọi logic liên quan tới FaceAPI: load models, detect, draw landmarks, clear canvas.
 * - Giữ API đơn giản để component chỉ cần gọi các hàm high-level.
 */

@Injectable({
  providedIn: 'root'
})
export class FaceDetectionService {
  private modelsLoaded = false;

  constructor() {}

  async loadModels(modelsPath = '/models'): Promise<void> {
    if (this.modelsLoaded) return;
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath)
      ]);
      this.modelsLoaded = true;
    } catch (err) {
      this.modelsLoaded = false;
      console.error('FaceDetectionService: Error loading models', err);
      throw err;
    }
  }

  /**
   * Detect single face from a HTMLVideoElement and optionally draw landmarks to canvas.
   * Returns the detection (or null) so caller can react accordingly.
   */
  async detectSingleFaceFromVideo(
    video: HTMLVideoElement,
    canvas?: HTMLCanvasElement,
    options: { draw?: boolean } = { draw: false }
  ): Promise<any | null> {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }
    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks().withFaceDescriptor();

      if (options.draw && canvas && detection) {
        this.prepareCanvasForVideo(canvas, video);
        const resized = faceapi.resizeResults(detection, { width: canvas.width, height: canvas.height });
        faceapi.draw.drawFaceLandmarks(canvas, resized.landmarks);
        this.drawBoldLandmarks(canvas, resized.landmarks);
      }

      return detection || null;
    } catch (err) {
      console.error('FaceDetectionService: detectSingleFaceFromVideo error', err);
      return null;
    }
  }

  /**
   * Detect single face from an image canvas (e.g., file upload) and optionally draw landmarks.
   */
  async detectSingleFaceFromCanvas(
    canvas: HTMLCanvasElement,
    options: { draw?: boolean } = { draw: true }
  ): Promise<any | null> {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }
    try {
      const detection = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks().withFaceDescriptor();;

      if (options.draw && detection) {
        const resized = faceapi.resizeResults(detection, { width: canvas.width, height: canvas.height });
        faceapi.draw.drawFaceLandmarks(canvas, resized.landmarks);
        this.drawBoldLandmarks(canvas, resized.landmarks);
      }

      return detection || null;
    } catch (err) {
      console.error('FaceDetectionService: detectSingleFaceFromCanvas error', err);
      return null;
    }
  }

  /**
   * Prepare canvas size from video dimensions and clear it.
   */
  prepareCanvasForVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    canvas.width = video.videoWidth || video.clientWidth || 640;
    canvas.height = video.videoHeight || video.clientHeight || 480;
    this.clearCanvas(canvas);
  }

  /**
   * Clear canvas safely.
   */
  clearCanvas(canvas?: HTMLCanvasElement | null) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Draw bolder landmark lines over faceapi default drawing.
   * Keeps drawing code in one place to avoid duplication.
   */
  private drawBoldLandmarks(canvas: HTMLCanvasElement, landmarks: any) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 2;

    const drawLandmarkLines = (points: faceapi.Point[]) => {
      if (!points || points.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    };

    drawLandmarkLines(landmarks.getJawOutline());
    drawLandmarkLines(landmarks.getLeftEyeBrow());
    drawLandmarkLines(landmarks.getRightEyeBrow());
    drawLandmarkLines(landmarks.getNose());
    drawLandmarkLines(landmarks.getLeftEye());
    drawLandmarkLines(landmarks.getRightEye());
    drawLandmarkLines(landmarks.getMouth());

    ctx.restore();
  }
}
