export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

export function ok<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

export function err(code: string, message: string, details?: ErrorDetail[]): ErrorEnvelope {
  return { success: false, error: details ? { code, message, details } : { code, message } };
}
