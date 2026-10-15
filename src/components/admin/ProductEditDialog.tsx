import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload, X, Star, Video, Play, Film, Clock, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { updateAdminDoc, uploadAdminMedia } from "@/lib/adminApi";

const inputCls = "bg-background/40 border-gold/20";

const UploadBtn = ({ label, onUploaded }: { label: string; onUploaded: (url: string) => void }) => {
  const [busy, setBusy] = useState(false);
  return (
    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-background/40 border border-gold/20 border-dashed cursor-pointer text-sm text-cosmic-silver/80 hover:text-gold transition-colors">
      <Upload className="h-4 w-4 text-gold" />
      {busy ? "Uploading..." : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast.error("Image must be under 5MB");
            return;
          }
          setBusy(true);
          try {
            const url = await uploadAdminMedia(file, "shop-images");
            if (url) {
              onUploaded(url);
              toast.success("Image uploaded");
            }
          } catch (err: any) {
            toast.error(err.message || "Failed to upload image");
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
};

// Check HTML5 video duration: strictly <= 60 seconds (1 minute max: 15s, 30s, 45s, 60s)
const checkVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      window.URL.revokeObjectURL(v.src);
      const duration = Math.round(v.duration);
      if (duration > 61) {
        reject(
          new Error(
            `Video duration is ${duration}s. Video must be 1 minute (60 seconds) or less! Allowed durations: 15s, 30s, 45s, 60s.`
          )
        );
      } else {
        resolve(duration);
      }
    };
    v.onerror = () => {
      reject(new Error("Unable to read video file metadata. Please use a valid MP4 or WebM video."));
    };
    v.src = URL.createObjectURL(file);
  });
};

type Props = { product: any | null; onClose: () => void; onSaved: () => void };

/** Edit every shop-facing field of an existing or current catalog product: details, price, images, and video. */
const ProductEditDialog = ({ product, onClose, onSaved }: Props) => {
  const [f, setF] = useState<any>({});
  const [gallery, setGallery] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState<"review" | "product">("review");
  const [videoDuration, setVideoDuration] = useState<number>(30);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoClientName, setVideoClientName] = useState("");
  const [videoUploading, setVideoUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setF({
      name: product.name ?? "",
      description: product.description ?? "",
      category: product.category ?? "",
      price: String(product.price ?? ""),
      stock: String(product.stock ?? 0),
      discount_percent: String(product.discount_percent ?? 0),
      rating: String(product.rating ?? 4.7),
      image_url: product.image_url ?? "",
      active: product.active !== false,
    });
    setGallery(Array.isArray(product.images) ? product.images.filter(Boolean) : []);
    setVideoUrl(product.video_url || "");
    setVideoType(product.video_type || (product.video_client_name ? "review" : "product"));
    setVideoDuration(Number(product.video_duration) || 30);
    setVideoTitle(product.video_title || "");
    setVideoClientName(product.video_client_name || "");
  }, [product]);

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.error("Video file size must be under 50MB");
      return;
    }

    try {
      setVideoUploading(true);
      const duration = await checkVideoDuration(file);
      // Snap to closest 15s, 30s, 45s, 60s
      let selectedDur = 30;
      if (duration <= 20) selectedDur = 15;
      else if (duration <= 37) selectedDur = 30;
      else if (duration <= 52) selectedDur = 45;
      else selectedDur = 60;

      setVideoDuration(selectedDur);

      toast.info(`Video validated (${duration}s duration). Uploading...`);
      const url = await uploadAdminMedia(file, "product-videos");
      if (url) {
        setVideoUrl(url);
        toast.success(`Video uploaded successfully (${selectedDur}s duration)!`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to process video");
    } finally {
      setVideoUploading(false);
    }
  };

  const save = async () => {
    if (!f.name?.trim()) return toast.error("Name required");
    if (!f.price) return toast.error("Price required");

    // Duration constraint enforcement
    const allowedDurations = [15, 30, 45, 60];
    const durationNum = Number(videoDuration) || 30;
    if (videoUrl && !allowedDurations.includes(durationNum)) {
      if (durationNum > 60) {
        return toast.error("Video duration cannot exceed 60 seconds (1 minute max). Choose 15s, 30s, 45s, or 60s.");
      }
    }

    const images = Array.from(new Set([f.image_url, ...gallery].filter(Boolean)));
    setSaving(true);
    try {
      const updatePayload = {
        name: f.name.trim(),
        description: f.description?.trim() || null,
        category: f.category?.trim() || null,
        price: Number(f.price),
        stock: parseInt(f.stock) || 0,
        discount_percent: Number(f.discount_percent) || 0,
        rating: Math.min(4.8, Number(f.rating) || 4.7),
        image_url: f.image_url || images[0] || null,
        images: images.length ? images : null,
        active: !!f.active,
        // Product Video & Client Review Video fields
        video_url: videoUrl.trim() || null,
        video_type: videoUrl.trim() ? videoType : null,
        video_duration: videoUrl.trim() ? durationNum : null,
        video_title: videoUrl.trim() ? (videoTitle.trim() || null) : null,
        video_client_name: videoUrl.trim() && videoType === "review" ? (videoClientName.trim() || null) : null,
        updated_at: new Date().toISOString(),
      };

      await updateAdminDoc("products", product.id, updatePayload);

      setSaving(false);
      toast.success("Product updated successfully with video details!");
      onSaved();
      onClose();
    } catch (err: any) {
      setSaving(false);
      toast.error(err.message || "Failed to update product");
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto glass-gold">
        <DialogHeader>
          <DialogTitle className="font-display text-gold flex items-center justify-between">
            <span>Edit Product: {product?.name}</span>
            {videoUrl && (
              <span className="text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30 flex items-center gap-1">
                <Video className="h-3 w-3" />
                {videoType === "review" ? "Client Review Video" : "Product Video"} ({videoDuration}s)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {product && (
          <div className="space-y-4 pt-1">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Product Name *</label>
                <Input placeholder="Product Name" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Category</label>
                <Input placeholder="Category (e.g. Bracelet, Chakra)" value={f.category ?? ""} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Price (₹) *</label>
                <Input placeholder="Price (₹)" type="number" value={f.price ?? ""} onChange={(e) => setF({ ...f, price: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Discount / Offer %</label>
                <Input placeholder="Offer / Discount %" type="number" value={f.discount_percent ?? ""} onChange={(e) => setF({ ...f, discount_percent: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Stock Quantity</label>
                <Input placeholder="Stock" type="number" value={f.stock ?? ""} onChange={(e) => setF({ ...f, stock: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-cosmic-silver/80 mb-1 block">Rating (max 4.8)</label>
                <Input placeholder="Rating (max 4.8)" type="number" step="0.1" value={f.rating ?? ""} onChange={(e) => setF({ ...f, rating: e.target.value })} className={inputCls} />
              </div>
            </div>

            <div>
              <label className="text-xs text-cosmic-silver/80 mb-1 block">Product Description</label>
              <Textarea placeholder="Description / details" rows={4} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} />
            </div>

            {/* PRODUCT VIDEO & CLIENT REVIEW VIDEO SECTION */}
            <div className="rounded-2xl border border-gold/30 bg-gold/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-gold" />
                  <span className="text-xs uppercase tracking-widest font-semibold text-gold">
                    Product &amp; Client Review Video (15s – 1 min max)
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3 text-gold" /> 15s · 30s · 45s · 60s max
                </span>
              </div>

              <p className="text-xs text-cosmic-silver/70">
                Shop page aur product details me video add karein. Client review video ya product showcase video add kar sakte hain (strictly 1 minute limit).
              </p>

              {/* Video Type selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-cosmic-silver/80 block">Video Type:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVideoType("review")}
                    className={`py-2 px-3 text-xs rounded-xl font-medium border flex items-center justify-center gap-1.5 transition-all ${
                      videoType === "review"
                        ? "bg-gradient-gold text-primary-foreground border-gold shadow"
                        : "bg-background/40 border-gold/20 text-cosmic-silver hover:border-gold/50"
                    }`}
                  >
                    <UserCheck className="h-3.5 w-3.5" /> Client Review Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoType("product")}
                    className={`py-2 px-3 text-xs rounded-xl font-medium border flex items-center justify-center gap-1.5 transition-all ${
                      videoType === "product"
                        ? "bg-gradient-gold text-primary-foreground border-gold shadow"
                        : "bg-background/40 border-gold/20 text-cosmic-silver hover:border-gold/50"
                    }`}
                  >
                    <Play className="h-3.5 w-3.5" /> Product Demo Video
                  </button>
                </div>
              </div>

              {/* Duration selector: 15s, 30s, 45s, 60s (1 min) */}
              <div className="space-y-1.5">
                <label className="text-xs text-cosmic-silver/80 flex items-center justify-between">
                  <span>Duration Limit (Allowed: 15s, 30s, 45s, 1 min):</span>
                  <span className="text-gold font-bold">{videoDuration} Seconds</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[15, 30, 45, 60].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setVideoDuration(sec)}
                      className={`py-1.5 text-xs rounded-lg border font-medium transition-all ${
                        videoDuration === sec
                          ? "bg-gold text-primary-foreground border-gold shadow-sm font-bold"
                          : "bg-background/40 border-gold/20 text-cosmic-silver/80 hover:border-gold/40"
                      }`}
                    >
                      {sec === 60 ? "60s (1 min)" : `${sec}s`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extra metadata: Client Name if review */}
              {videoType === "review" && (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-xs text-cosmic-silver/80 mb-1 block">Client / Customer Name</label>
                    <Input
                      placeholder="e.g. Priya Shah (Surat)"
                      value={videoClientName}
                      onChange={(e) => setVideoClientName(e.target.value)}
                      className={`text-xs ${inputCls}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-cosmic-silver/80 mb-1 block">Review Video Title</label>
                    <Input
                      placeholder="e.g. Real results after wearing for 7 days"
                      value={videoTitle}
                      onChange={(e) => setVideoTitle(e.target.value)}
                      className={`text-xs ${inputCls}`}
                    />
                  </div>
                </div>
              )}

              {videoType === "product" && (
                <div>
                  <label className="text-xs text-cosmic-silver/80 mb-1 block">Video Title</label>
                  <Input
                    placeholder="e.g. Authentic energisation process and natural shine"
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    className={`text-xs ${inputCls}`}
                  />
                </div>
              )}

              {/* Video upload / URL input */}
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-gold text-primary-foreground font-semibold cursor-pointer text-xs shadow-md hover:opacity-95 transition-all">
                    <Video className="h-4 w-4" />
                    {videoUploading ? "Validating & Uploading..." : "Choose Video from Gallery / Device"}
                    <input
                      type="file"
                      accept="video/*,video/mp4,video/webm,video/quicktime,video/m4v,video/3gp,video/mkv"
                      className="hidden"
                      disabled={videoUploading}
                      onChange={handleVideoFile}
                    />
                  </label>
                  {videoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setVideoUrl("");
                        setVideoTitle("");
                        setVideoClientName("");
                      }}
                      className="text-xs text-destructive hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      <X className="h-3 w-3" /> Remove Video
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-cosmic-silver/70">Or Enter Direct Video URL (MP4 / WebM / Cloud):</label>
                  <Input
                    placeholder="https://example.com/video.mp4"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className={`text-xs ${inputCls}`}
                  />
                </div>

                {/* Video Preview */}
                {videoUrl && (
                  <div className="mt-2 rounded-xl overflow-hidden border border-gold/30 bg-background/80 p-2 space-y-2">
                    <div className="flex items-center justify-between text-xs text-gold">
                      <span className="font-semibold flex items-center gap-1.5">
                        <Play className="h-3 w-3" />
                        Preview: {videoType === "review" ? "Client Review" : "Product Video"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-gold/15 text-[10px] font-bold border border-gold/30">
                        {videoDuration}s Max
                      </span>
                    </div>
                    <div className="aspect-video max-h-48 rounded-lg overflow-hidden bg-black/60 flex items-center justify-center">
                      <video
                        src={videoUrl}
                        controls
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* MAIN IMAGE */}
            <div>
              <label className="text-xs uppercase tracking-widest text-gold/70 mb-2 block">Main Photo</label>
              <div className="flex items-center gap-4">
                <UploadBtn label="Replace Main Photo" onUploaded={(url) => setF((p: any) => ({ ...p, image_url: url }))} />
                {f.image_url && <img src={f.image_url} alt={f.name} className="h-16 w-16 rounded-lg object-cover border border-gold/20" />}
              </div>
            </div>

            {/* GALLERY IMAGES */}
            <div>
              <label className="text-xs uppercase tracking-widest text-gold/70 mb-2 block">Gallery Photos</label>
              <div className="flex flex-wrap items-center gap-3">
                <UploadBtn label="Add Photo" onUploaded={(url) => setGallery((g) => (g.includes(url) ? g : [...g, url]))} />
                {gallery.map((url) => (
                  <div key={url} className="relative">
                    <img src={url} alt="gallery" className="h-16 w-16 rounded-lg object-cover border border-gold/20" />
                    <button type="button" aria-label="Remove image" onClick={() => setGallery((g) => g.filter((u) => u !== url))} className="absolute -top-2 -right-2 bg-background rounded-full text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                    {url !== f.image_url && (
                      <button type="button" aria-label="Make main image" onClick={() => setF((p: any) => ({ ...p, image_url: url }))} className="absolute -bottom-2 -right-2 bg-background rounded-full text-gold">
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-cosmic-silver/80">
              <input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              Visible in shop
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="border-gold/30">Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-gradient-gold text-primary-foreground font-semibold">
                {saving ? "Saving Changes..." : "Save Product & Video"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductEditDialog;
