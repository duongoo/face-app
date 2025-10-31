import { Component, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FaceDetectionService } from './face-detection.service';
import { ApiService } from './api.service';

/**
 * CheckInComponent
 * - Component chính cho feature check-in & registration.
 * - Đã tách logic FaceAPI và API calls ra service để component chỉ còn quản lý UI + flow.
 *
 * Mục tiêu refactor:
 * - Gom các hàm xử lý chung vào region "Utility" (private helpers).
 * - Thêm region rõ ràng cho từng nhóm chức năng.
 * - Thêm comment tiếng Việt ngắn gọn cho mỗi hàm để dễ maintain.
 */

@Component({
  standalone: true,
  selector: 'app-check-in',
  imports: [CommonModule, FormsModule],
  templateUrl: './check-in.component.html',
  styleUrls: ['./check-in.component.scss']
})
export class CheckInComponent {
  // #region UI state & ViewChilds
  private _videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoElement', { static: false })
  set videoElement(element: ElementRef<HTMLVideoElement>) {
    this._videoElement = element;
    // Nếu mode đang là camera và element đã sẵn sàng => start camera
    if (this.currentMode === 'camera' && this._videoElement) {
      this.startCamera();
    }
  }
  get videoElement(): ElementRef<HTMLVideoElement> {
    return this._videoElement;
  }

  @ViewChild('canvasElement', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileCanvasElement', { static: false }) fileCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('registrationFileInput') registrationFileInput!: ElementRef<HTMLInputElement>;

  loading = false; // chung cho action network
  loaddingModels = false; // trạng thái tải models
  checkInResult = '';
  faceValid = false;
  faceDetecting = false;
  currentMode: 'camera' | 'file' = 'camera';
  selectedFile: File | null = null;
  selectedDescriptor: Float32Array = new Float32Array();

  private detectionInterval: any = null;
  isDragging = false;

  // Registration state
  isRegistrationDisabled = false;
  registrationName = '';
  registrationCode = '';
  registrationFile: File | null = null;
  registrationLoading = false;
  registrationResult = '';
  registrationStatus: 'idle' | 'success' | 'error' | 'info' = 'idle';
  // #endregion

  // #region Constructor
  constructor(
    private cdr: ChangeDetectorRef,
    private faceService: FaceDetectionService,
    private apiService: ApiService
  ) {}
  // #endregion

  // #region Lifecycle
  async ngOnInit() {
    // Tải models khi component khởi tạo
    await this.safeLoadModels();
  }

  ngAfterViewInit() {
    // Nếu mode mặc định là camera, bắt đầu vòng detect
    if (this.currentMode === 'camera') {
      this.startFaceDetectionLoop();
    }
  }
  // #endregion

  // #region Mode & Camera control
  /**
   * Toggle giữa chế độ camera và file
   */
  toggleMode(mode: 'camera' | 'file') {
    this.currentMode = mode;
    this.resetCheckInState();

    if (mode === 'camera') {
      if (this.videoElement) this.startCamera();
      this.startFaceDetectionLoop();
    } else {
      this.selectedFile = null;
      this.selectedDescriptor = new Float32Array();
      this.stopCamera();
      this.stopFaceDetectionLoop();
      this.clearCanvasIfExists(this.canvasElement?.nativeElement);
      this.clearCanvasIfExists(this.fileCanvasElement?.nativeElement);
    }
    this.cdr.detectChanges();
  }

  startCamera() {
    if (!this.videoElement) return;
    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      const video = this.videoElement.nativeElement;
      video.srcObject = stream;
      video.play().catch(() => {});
    }).catch(err => {
      console.error('startCamera error', err);
    });
  }

  stopCamera() {
    if (!this.videoElement || !this.videoElement.nativeElement) return;
    const video = this.videoElement.nativeElement;
    const stream = video.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
  }

  startFaceDetectionLoop() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    // Nhạy: 100ms. Có thể điều chỉnh để tiết kiệm CPU.
    this.detectionInterval = setInterval(() => void this.detectFace(), 100);
  }

  stopFaceDetectionLoop() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    this.faceValid = false;
    this.cdr.detectChanges();
  }
  // #endregion

  // #region Face detection (camera)
  /**
   * Thực hiện detect trên video hiện tại và vẽ landmark lên canvas (nếu có).
   * Sử dụng FaceDetectionService để gom logic FaceAPI.
   */
  timerHandleCheckin: any;

  async detectFace() {
    if (!this.videoElement || !this.canvasElement) return;
    this.setFaceDetecting(true);

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    // Service chuẩn hóa canvas và vẽ landmark bên trong service
    this.faceService.prepareCanvasForVideo(canvas, video);
    const detection = await this.faceService.detectSingleFaceFromVideo(video, canvas, { draw: true });

    this.faceValid = !!detection;
    if (this.faceValid) {
      // Lưu descriptor nếu cần dùng cho check-in bằng detection
      this.selectedDescriptor = detection.descriptor;
      // Only schedule handleCheckIn if not loading and not already scheduled
      if (!this.loading && !this.timerHandleCheckin) {
        this.timerHandleCheckin = setTimeout(async () => {
          // Double-check loading before calling handleCheckIn
          if (!this.loading) {
            await this.handleCheckIn();
          }
          this.timerHandleCheckin = null;
          console.log('clear timer checkin');
        }, 3000);
        console.log('Set timeout handle checkin', this.timerHandleCheckin);
      }
    }
    this.setFaceDetecting(false);
  }

  /**
   * Capture frame từ video và gửi lên backend để check-in
   */
  async handleCheckIn() {
    if (!this.videoElement || !this.canvasElement) {
      this.setResult('Lỗi: Không tìm thấy yếu tố video hoặc canvas.');
      return;
    }

    if(!this.faceValid){
      this.setResult('Chưa phát hiện được khuôn mặt từ camera.');
      return;
    }

    this.setLoading(true);
    this.stopFaceDetectionLoop();

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    this.faceService.prepareCanvasForVideo(canvas, video);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      //const blob = await (await fetch(canvas.toDataURL('image/jpeg'))).blob();
      // const res = await this.apiService.checkInWithBlob(blob); // gửi blob video
      const res = await this.apiService.checkInWithDescriptor(this.selectedDescriptor);
      this.setResultFromApiResponse(res);
      this.startFaceDetectionLoop();
    } catch (err: any) {
      if(err.body && err.body.message){
        this.setResult(err.body.message);
      } else {  
        this.setResult('Lỗi kết nối API!');
        console.error('handleCheckIn error', err);
      }
    } finally {
      this.setLoading(false);
      this.startFaceDetectionLoop();
    }
  }
  // #endregion

  // #region File handling (upload & check-in)
  /**
   * Thao tác khi user chọn file từ input
   */
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.resetSelectedFile();
      return;
    }
    this.selectedFile = input.files[0];
    // Đọc ảnh, vẽ lên canvas và detect
    this.processSelectedFile();
  }

  private async processSelectedFile() {
    if (!this.selectedFile) return;
    this.setModelsLoading(true);
    this.setResult('');
    try {
      const dataUrl = await this.readFileAsDataUrl(this.selectedFile);
      const img = await this.createImageElement(dataUrl);

      // Ensure canvas rendered
      await Promise.resolve();
      if (!this.fileCanvasElement || !this.fileCanvasElement.nativeElement) {
        throw new Error('fileCanvasElement undefined');
      }
      const canvas = this.fileCanvasElement.nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context missing');

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      this.setFaceDetecting(true);
      const detection = await this.faceService.detectSingleFaceFromCanvas(canvas, { draw: true });
      this.faceValid = !!detection;
      if(this.faceValid){
        this.selectedDescriptor = detection.descriptor;
        this.handleFileCheckIn();
        
      }
    } catch (err) {
      console.error('processSelectedFile error', err);
    } finally {
      this.setFaceDetecting(false);
      this.setModelsLoading(false);
    }
  }

  /**
   * Gửi file đã chọn lên API để check-in
   */
  async handleFileCheckIn() {
    // if (!this.selectedFile) {
    //   this.setResult('Vui lòng chọn một file ảnh để check-in.');
    //   return;
    // }
    if(!this.selectedDescriptor || this.selectedDescriptor.length === 0){
      this.setResult('Chưa phát hiện được khuôn mặt trong ảnh.');
      return;
    }
    this.setLoading(true);
    try {
      // const res = await this.apiService.checkInWithFile(this.selectedFile); // gửi file
      const res = await this.apiService.checkInWithDescriptor(this.selectedDescriptor);
      this.setResultFromApiResponse(res);
    } catch (err: any) {
      this.setResult('Lỗi kết nối API!');
    } finally {
      this.setLoading(false);
    }
  }
  // #endregion

  // #region Registration
  triggerRegistrationFilePicker(): void {
    this.registrationFileInput?.nativeElement?.click();
  }

  onRegistrationFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;
    this.registrationFile = file;
    this.registrationResult = '';
    this.registrationStatus = 'idle';
    this.cdr.detectChanges();
  }

  clearRegistrationFile(options: { detectChanges?: boolean; resetStatus?: boolean } = {}) {
    const { detectChanges = true, resetStatus = true } = options;
    this.registrationFile = null;
    if (this.registrationFileInput) this.registrationFileInput.nativeElement.value = '';
    if (resetStatus) {
      this.registrationStatus = 'idle';
      this.registrationResult = '';
    }
    if (detectChanges) this.cdr.detectChanges();
  }

  async handleRegistrationSubmit(event?: Event) {
    event?.preventDefault();
    const name = this.registrationName.trim();
    const code = this.registrationCode.trim();

    if (!name || !code) {
      this.registrationStatus = 'error';
      this.registrationResult = 'Vui lòng nhập đầy đủ họ tên và mã khách hàng.';
      this.cdr.detectChanges();
      return;
    }
    if (!this.registrationFile) {
      this.registrationStatus = 'error';
      this.registrationResult = 'Vui lòng chọn ảnh khuôn mặt để đăng ký.';
      this.cdr.detectChanges();
      return;
    }
    this.isRegistrationDisabled = true;
    this.registrationLoading = true;
    this.registrationStatus = 'info';
    this.registrationResult = 'Đang đăng ký khách hàng...';
    this.cdr.detectChanges();

    try {
      const res = await this.apiService.registerCustomer(name, code, this.registrationFile);
      if (res.success) {
        this.registrationStatus = 'success';
        this.registrationResult = res.message || 'Đăng ký khách hàng thành công!';
        this.registrationName = '';
        this.registrationCode = '';
        this.clearRegistrationFile({ detectChanges: false, resetStatus: false });
      } else {
        this.registrationStatus = 'error';
        this.registrationResult = res.message || 'Đăng ký khách hàng thất bại!';
      }
    } catch (err) {
      this.registrationStatus = 'error';
      this.registrationResult = 'Lỗi kết nối API đăng ký!';
    } finally {
      this.registrationLoading = false;
      this.isRegistrationDisabled = false;
      this.cdr.detectChanges();
    }
  }
  // #endregion

  // #region Drag & Drop
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      // reuse file input handling
      this.onFileSelected({ target: { files } } as unknown as Event);
    }
  }
  // #endregion

  // #region Utilities (private helpers) - gom các xử lý dùng chung
  private setLoading(value: boolean) {
    this.loading = value;
    this.cdr.detectChanges();
  }

  private setModelsLoading(value: boolean) {
    this.loaddingModels = value;
    this.cdr.detectChanges();
  }

  private setFaceDetecting(value: boolean) {
    this.faceDetecting = value;
    this.cdr.detectChanges();
  }

  private setResult(message: string) {
    this.checkInResult = message;
    this.cdr.detectChanges();
  }

  private setResultFromApiResponse(res: any) {
    if (res && res.success) {
      this.checkInResult = `Check-in thành công! User :  ${res.customer?.name} -- distance : ${res.customer?.distance}`;
    } else {
      this.checkInResult = res?.message || 'Check-in thất bại!';
    }
    this.cdr.detectChanges();
  }

  private resetSelectedFile() {
    this.selectedFile = null;
    this.faceValid = false;
    this.faceDetecting = false;
    this.selectedDescriptor = new Float32Array();
    this.clearCanvasIfExists(this.fileCanvasElement?.nativeElement);
    this.cdr.detectChanges();
  }

  private resetCheckInState() {
    this.checkInResult = '';
    this.faceValid = false;
    this.faceDetecting = false;
  }

  private clearCanvasIfExists(canvas?: HTMLCanvasElement | null) {
    this.faceService.clearCanvas(canvas || undefined);
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File read error'));
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  private createImageElement(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load error'));
      img.src = dataUrl;
    });
  }

  private async safeLoadModels() {
    this.setModelsLoading(true);
    this.setResult('Đang tải mô hình nhận diện khuôn mặt...');
    try {
      await this.faceService.loadModels();
      this.setResult('Mô hình đã tải xong.');
    } catch (err) {
      console.error('safeLoadModels error', err);
      this.setResult('Lỗi khi tải mô hình FaceAPI! Vui lòng kiểm tra lại các tệp mô hình.');
    } finally {
      this.setModelsLoading(false);
    }
  }
  // #endregion
}
