export interface AuthNotifyParams {
  userId: string;
  email: string;
  fullName?: string;
  eventType: "login" | "register";
  authMethod: "password" | "google";
}

/**
 * Auth notification stub - automated email notifications removed per system specifications.
 */
export async function notifyAuthSuccess(_params: AuthNotifyParams): Promise<void> {
  // Automatic email sending has been disabled
}

