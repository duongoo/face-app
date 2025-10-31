import { Injectable } from '@angular/core';

export type ApiResponse<T = any> = {
  success: boolean;
  message?: string;
  customer?: T;
};

/**
 * ApiService
 * - Gom các cuộc gọi tới backend: checkin, register
 * - Sử dụng fetch để tránh phụ thuộc vào HttpClientModule (giữ đơn giản cho refactor)
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = 'http://localhost:3000';

  constructor() {}

  private async postForm(endpoint: string, formData: FormData): Promise<ApiResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (res.ok) return json;
      // Non-OK but JSON body (400 et al.)
      throw { status: res.status, body: json };
    } else {
      if (res.ok) return { success: true };
      throw { status: res.status, statusText: res.statusText };
    }
  }

  async checkInWithBlob(blob: Blob): Promise<ApiResponse> {
    const fd = new FormData();
    fd.append('imageFile', blob, 'capture.jpg');
    return this.postForm('/checkin', fd);
  }

  async checkInWithFile(file: File): Promise<ApiResponse> {
    const fd = new FormData();
    fd.append('imageFile', file, file.name);
    return this.postForm('/checkin', fd);
  }

  async checkInWithDescriptor(descriptor: Float32Array): Promise<ApiResponse> {
    // descriptor đã là Float32Array => dùng buffer trực tiếp, cast về ArrayBuffer để tránh lỗi type
    const blob = new Blob([descriptor.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const fd = new FormData();
    fd.append('descriptor', blob, 'descriptor.bin');
    return this.postForm('/checkin/detection', fd);
  }

  async registerCustomer(name: string, code: string, file: File): Promise<ApiResponse> {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('code', code);
    fd.append('imageFile', file, file.name);
    return this.postForm('/register', fd);
  }
  async registerCustomerWithDescriptor(name: string, code: string, descriptor: Float32Array): Promise<ApiResponse> {
    // descriptor đã là Float32Array => dùng buffer trực tiếp; cast về ArrayBuffer để tránh lỗi type
    const blob = new Blob([descriptor.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const fd = new FormData();
    fd.append('name', name);
    fd.append('code', code);
    fd.append('descriptor', blob, 'descriptor.bin');
    return this.postForm('/register/detection', fd);
  }
}
