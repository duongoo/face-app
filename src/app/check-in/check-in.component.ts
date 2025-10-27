import { Component, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as faceapi from 'face-api.js';

@Component({
  standalone: true,
  selector: 'app-check-in',
  imports: [CommonModule],
  templateUrl: './check-in.component.html',
  styleUrls: ['./check-in.component.scss']
})
export class CheckInComponent {
  private _videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoElement', { static: false })
  set videoElement(element: ElementRef<HTMLVideoElement>) {
    this._videoElement = element;
    if (this.currentMode === 'camera' && this._videoElement) {
      this.startCamera();
    }
  }
  get videoElement(): ElementRef<HTMLVideoElement> {
    return this._videoElement;
  }

  @ViewChild('canvasElement', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileCanvasElement', { static: false }) fileCanvasElement!: ElementRef<HTMLCanvasElement>;

  loading: boolean = false;
  loaddingModels: boolean = false;
  checkInResult: string = '';
  faceValid: boolean = false;
  faceDetecting: boolean = false; // New state for detection in progress
  currentMode: 'camera' | 'file' = 'camera'; // 'camera' or 'file'
  selectedFile: File | null = null;
  private detectionInterval: any; // For camera face detection loop
  isDragging: boolean = false; // New property for drag-and-drop styling

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>; // Reference to the hidden file input

  constructor(private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    this.loadModels(); // Ensure models are loaded on init
    // No need to call startCamera here, toggleMode will handle it
  }

  // ngAfterViewInit is not strictly necessary for starting camera if toggleMode handles it
  // However, if the initial mode is 'camera', we need to ensure it starts.
  // Let's keep it for initial setup, but ensure videoElement is available.
  ngAfterViewInit() {
    // The videoElement setter will handle starting the camera if currentMode is 'camera'
    // We also need to start the detection loop if initially in camera mode
    if (this.currentMode === 'camera') {
      this.startFaceDetectionLoop();
    }
  }

  toggleMode(mode: 'camera' | 'file') {
    this.currentMode = mode;
    this.checkInResult = ''; // Clear previous result
    this.faceValid = false; // Reset face detection status
    this.faceDetecting = false; // Reset detection in progress status
    if (mode === 'camera') {
      // The videoElement setter will handle starting the camera
      // We need to ensure the setter is triggered if the element is already in DOM
      if (this.videoElement) {
        this.startCamera();
      }
      this.startFaceDetectionLoop(); // Start detection loop for camera
    } else {
      this.selectedFile = null; // Clear selected file when switching to file mode
      this.stopCamera();
      this.stopFaceDetectionLoop(); // Stop detection loop for file mode
      if (this.canvasElement) { // Add null check for canvasElement
        this.clearCanvas(this.canvasElement.nativeElement);
      }
      if (this.fileCanvasElement) { // Add null check for fileCanvasElement
        this.clearCanvas(this.fileCanvasElement.nativeElement);
      }
    }
    this.cdr.detectChanges();
  }

  startFaceDetectionLoop() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    this.detectionInterval = setInterval(() => this.detectFace(), 100); // Run detection every 100ms
  }

  stopFaceDetectionLoop() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    this.faceValid = false; // Reset faceValid when stopping loop
    this.cdr.detectChanges();
  }

  async loadModels() {
    this.loaddingModels = true; // Set loaddingModels to true before loading models
    this.checkInResult = 'Đang tải mô hình nhận diện khuôn mặt...'; // Inform user
    this.cdr.detectChanges(); // Update UI immediately

    try {
      // Only load models that are actually used or explicitly requested
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
      await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
      this.checkInResult = 'Mô hình đã tải xong.'; // Clear or update message
    } catch (error) {
      console.error('Error loading models:', error);
      this.checkInResult = 'Lỗi khi tải mô hình FaceAPI! Vui lòng kiểm tra lại các tệp mô hình.';
    } finally {
      this.loaddingModels = false; // Set loaddingModels to false after models are loaded
      this.cdr.detectChanges(); // Manually trigger change detection
    }
  }

  startCamera() {
    if (this.videoElement) {
      navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
        this.videoElement.nativeElement.srcObject = stream;
        this.videoElement.nativeElement.play();
      });
    }
  }

  stopCamera() {
    if (this.videoElement && this.videoElement.nativeElement) {
      const video = this.videoElement.nativeElement;
      const stream = video.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
      }
    }
  }

  async detectFace() {
    if (!this.videoElement || !this.canvasElement) return; // Add null checks
    this.faceDetecting = true; // Indicate detection is in progress
    this.cdr.detectChanges();

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    // ctx?.drawImage(video, 0, 0, canvas.width, canvas.height); // Removed: Canvas should not draw video

    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();

    this.faceValid = !!detections;
    this.faceDetecting = false; // Detection finished
    this.cdr.detectChanges(); // Update UI for faceValid change

    if (detections) {
      const resizedDetections = faceapi.resizeResults(detections, { width: canvas.width, height: canvas.height });
      // Draw default landmarks first
      faceapi.draw.drawFaceLandmarks(canvas, resizedDetections.landmarks);

      // Manually draw bolder lines over the default ones
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = 'blue'; // Color for bolder lines
        ctx.lineWidth = 4; // Bolder line width

        const drawLandmarkLines = (points: faceapi.Point[]) => {
          ctx.beginPath();
          for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (i === 0) {
              ctx.moveTo(point.x, point.y);
            } else {
              ctx.lineTo(point.x, point.y);
            }
          }
          ctx.stroke();
        };

        // Draw jawline
        drawLandmarkLines(resizedDetections.landmarks.getJawOutline());
        // Draw eyebrows
        drawLandmarkLines(resizedDetections.landmarks.getLeftEyeBrow());
        drawLandmarkLines(resizedDetections.landmarks.getRightEyeBrow());
        // Draw nose
        drawLandmarkLines(resizedDetections.landmarks.getNose());
        // Draw eyes
        drawLandmarkLines(resizedDetections.landmarks.getLeftEye());
        drawLandmarkLines(resizedDetections.landmarks.getRightEye());
        // Draw mouth
        drawLandmarkLines(resizedDetections.landmarks.getMouth());
      }
    }
  }

  async handleCheckIn() {
    if (!this.videoElement || !this.canvasElement) { // Add comprehensive null checks
      this.checkInResult = 'Lỗi: Không tìm thấy yếu tố video hoặc canvas.';
      this.cdr.detectChanges();
      return;
    }

    this.loading = true;
    // this.faceValid = false; // Reset face detection status during check-in
    // this.faceDetecting = false; // Reset detection in progress status
    this.stopFaceDetectionLoop(); // Stop detection during check-in
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas before drawing captured image
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageDataUrl = canvas.toDataURL('image/jpeg');

    try {
      // Convert data URL to binary Blob and send as form-data key 'imageFile'
      const blob = await (await fetch(imageDataUrl)).blob();
      const formData = new FormData();
      formData.append('imageFile', blob, 'capture.jpg');

      const response = await fetch('http://localhost:3000/checkin', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) { // HTTP status code 200-299
        const result = await response.json();
        if (result.success) {
          this.checkInResult = `Check-in thành công! User :  ${result.customer.name} -- distance : ${result.customer.distance}`;
        } else {
          // This case might happen if API returns 200 but with success: false
          this.checkInResult = result.message || 'Check-in thất bại!';
        }
      } else if (response.status === 400) {
        const errorResult = await response.json();
        this.checkInResult = errorResult.message || 'Yêu cầu không hợp lệ!';
      } else {
        this.checkInResult = `Lỗi API: ${response.status} ${response.statusText}`;
      }
      this.startFaceDetectionLoop(); // Resume detection after check-in
    } catch (error) {
      this.checkInResult = 'Lỗi kết nối API!';
    } finally {
      this.loading = false;
      this.cdr.detectChanges(); // Manually trigger change detection
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      this.cdr.detectChanges(); // Force change detection to render the canvas
      this.loaddingModels = true;
      this.checkInResult = ''; // Clear previous result
      this.cdr.detectChanges(); // Trigger UI update for loading state
      const reader = new FileReader();
      try {
        reader.onload = (e: any) => {
          const img = new Image();
          img.onload = () => {
            // Use Promise.resolve().then() to ensure the canvas element is rendered and ViewChild is resolved
            Promise.resolve().then(async () => {
              if (this.fileCanvasElement && this.fileCanvasElement.nativeElement) {
                const canvas = this.fileCanvasElement.nativeElement;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  canvas.width = img.width;
                  canvas.height = img.height;
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // Removed: Canvas should not draw image

                  this.faceDetecting = true; // Indicate detection is in progress
                  this.cdr.detectChanges();

                  // Perform face detection on the uploaded image
                  const detections = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
                  this.faceValid = !!detections; // Set faceValid based on detection
                  this.faceDetecting = false; // Detection finished
                  this.cdr.detectChanges(); // Update UI for faceValid change

                  if (detections) {
                    const resizedDetections = faceapi.resizeResults(detections, { width: canvas.width, height: canvas.height });
                    // Draw default landmarks first
                    faceapi.draw.drawFaceLandmarks(canvas, resizedDetections.landmarks);

                    // Manually draw bolder lines over the default ones
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                      ctx.strokeStyle = 'blue'; // Color for bolder lines
                      ctx.lineWidth = 4; // Bolder line width

                      const drawLandmarkLines = (points: faceapi.Point[]) => {
                        ctx.beginPath();
                        for (let i = 0; i < points.length; i++) {
                          const point = points[i];
                          if (i === 0) {
                            ctx.moveTo(point.x, point.y);
                          } else {
                            ctx.lineTo(point.x, point.y);
                          }
                        }
                        ctx.stroke();
                      };

                      // Draw jawline
                      drawLandmarkLines(resizedDetections.landmarks.getJawOutline());
                      // Draw eyebrows
                      drawLandmarkLines(resizedDetections.landmarks.getLeftEyeBrow());
                      drawLandmarkLines(resizedDetections.landmarks.getRightEyeBrow());
                      // Draw nose
                      drawLandmarkLines(resizedDetections.landmarks.getNose());
                      // Draw eyes
                      drawLandmarkLines(resizedDetections.landmarks.getLeftEye());
                      drawLandmarkLines(resizedDetections.landmarks.getRightEye());
                      // Draw mouth
                      drawLandmarkLines(resizedDetections.landmarks.getMouth());
                    }
                  }
                }
              } else {
                console.error('fileCanvasElement.nativeElement is undefined after Promise.resolve().then()');
              }
              this.loaddingModels = false;
              this.cdr.detectChanges(); // Trigger UI update when loading is complete
            });
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(this.selectedFile);
      } catch (error) {
        this.loaddingModels = false;
        this.cdr.detectChanges(); // Trigger UI update on error
      }
    } else {
      this.selectedFile = null;
      this.faceValid = false; // Reset faceValid if no file selected
      this.faceDetecting = false; // Reset detection in progress status
      if (this.fileCanvasElement) {
        this.clearCanvas(this.fileCanvasElement.nativeElement);
      }
    }
    this.cdr.detectChanges();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault(); // Prevent default to allow drop
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault(); // Prevent default action (open as link for some elements)
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.onFileSelected({ target: { files: files } } as unknown as Event);
    }
  }

  async handleFileCheckIn() {
    if (!this.selectedFile) {
      this.checkInResult = 'Vui lòng chọn một file ảnh để check-in.';
      this.cdr.detectChanges();
      return;
    }

    this.loading = true;
    this.checkInResult = ''; // Clear previous result
    // this.faceValid = false; // Reset face detection status during check-in
    // this.faceDetecting = false; // Reset detection in progress status

    try {
      const formData = new FormData();
      formData.append('imageFile', this.selectedFile, this.selectedFile.name);

      const response = await fetch('http://localhost:3000/checkin', {
        method: 'POST',
        body: formData
      });

      if (response.ok) { // HTTP status code 200-299
        const result = await response.json();
        if (result.success) {
          this.checkInResult = `Check-in thành công! User :  ${result.customer.name} -- distance : ${result.customer.distance}`;
        } else {
          this.checkInResult = result.message || 'Check-in thất bại!';
        }
      } else if (response.status === 400) {
        const errorResult = await response.json();
        this.checkInResult = errorResult.message || 'Yêu cầu không hợp lệ!';
      } else {
        this.checkInResult = `Lỗi API: ${response.status} ${response.statusText}`;
      }
    } catch (error) {
      this.checkInResult = 'Lỗi kết nối API!';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  clearCanvas(canvas: HTMLCanvasElement | undefined) { // Allow undefined
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
}
