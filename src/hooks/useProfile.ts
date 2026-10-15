import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
};

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const docRef = doc(db, "profiles", user.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setProfile({ id: snap.id, ...(snap.data() as Omit<Profile, "id">) });
      } else {
        setProfile(null);
      }
    } catch (err) {
      console.warn("Error fetching profile from Firestore:", err);
      setProfile(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (patch: Partial<Profile>) => {
    if (!user) return { error: new Error("Not signed in") };
    try {
      const docRef = doc(db, "profiles", user.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        await updateDoc(docRef, { ...patch, updated_at: new Date().toISOString() });
      } else {
        await setDoc(docRef, {
          id: user.id,
          full_name: user.displayName || null,
          email: user.email || null,
          phone: user.phoneNumber || null,
          created_at: new Date().toISOString(),
          ...patch,
        });
      }
      await load();
      return { error: null };
    } catch (error: any) {
      console.error("Profile update error:", error);
      return { error };
    }
  };

  return { profile, loading, reload: load, update };
};
