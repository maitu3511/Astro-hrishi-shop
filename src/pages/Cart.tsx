import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { resolveImage } from "@/lib/productImages";
import { inr, shippingFor } from "@/lib/shop";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { trackViewCart, trackRemoveFromCart, trackBeginCheckout } from "@/lib/analytics";

const Cart = () => {
  const nav = useNavigate();
  const items = useCart((s) => s.items);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const requireAuth = useRequireAuth();
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.price * i.quantity, 0), [items]);
  const shipping = shippingFor(subtotal);
  const trackedRef = useRef(false);

  // Track view_cart on load if items exist
  useEffect(() => {
    if (items.length > 0 && !trackedRef.current) {
      trackedRef.current = true;
      trackViewCart(
        items.map((i) => ({
          id: i.product_id || i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          variant: i.variant,
        })),
        subtotal
      );
    }
  }, [items, subtotal]);

  const handleRemove = (item: (typeof items)[0]) => {
    trackRemoveFromCart(
      {
        id: item.product_id || item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      },
      item.quantity
    );
    remove(item.id);
  };

  const handleProceedToCheckout = () => {
    if (!requireAuth()) return;
    trackBeginCheckout(
      items.map((i) => ({
        id: i.product_id || i.id,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        variant: i.variant,
      })),
      subtotal + shipping
    );
    nav("/checkout");
  };

  return (
    <PageLayout title="Your Cart" subtitle={items.length ? `${items.length} item${items.length > 1 ? "s" : ""} ready for checkout` : undefined}>
      <SEO
        title="Your Cart — Astro With Hrishi | Review Items"
        description="Review your selected energised astrology products and gemstones before proceeding to safe and secure checkout."
        path="/cart"
        noindex
      />
      <div className="container">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 text-gold mx-auto mb-5" />
            <p className="text-muted-foreground mb-8">Your cart is empty.</p>
            <Button asChild size="lg" className="rounded-full px-8 bg-gradient-gold text-primary-foreground">
              <Link to="/shop">Browse Collection</Link>
            </Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
            <div className="space-y-4">
              {items.map((i) => (
                <div key={i.id} className="lux-card rounded-2xl p-4 flex gap-4 items-center">
                  <img src={resolveImage(i.image_url)} alt={i.name} className="h-24 w-24 rounded-xl object-cover bg-secondary" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-lg truncate">{i.name}</h3>
                    {i.variant && <p className="text-xs text-muted-foreground">{i.variant}</p>}
                    <p className="text-sm font-semibold mt-1">{inr(i.price)}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center border border-border rounded-full">
                        <button onClick={() => setQty(i.id, i.quantity - 1)} className="h-8 w-8 flex items-center justify-center hover:text-gold" aria-label="Decrease">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-7 text-center text-sm">{i.quantity}</span>
                        <button onClick={() => setQty(i.id, i.quantity + 1)} className="h-8 w-8 flex items-center justify-center hover:text-gold" aria-label="Increase">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => handleRemove(i)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                  <div className="font-display text-lg whitespace-nowrap">{inr(i.price * i.quantity)}</div>
                </div>
              ))}
            </div>

            <aside className="lux-card rounded-2xl p-6 lg:sticky lg:top-28">
              <h2 className="font-display text-xl mb-5">Order Summary</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{inr(subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{shipping === 0 ? "Free" : inr(shipping)}</span></div>
                <div className="h-px bg-border my-3" />
                <div className="flex justify-between font-display text-lg"><span>Total</span><span>{inr(subtotal + shipping)}</span></div>
              </div>
              <Button onClick={handleProceedToCheckout} size="lg" className="w-full mt-6 rounded-full bg-gradient-gold text-primary-foreground">
                Proceed to Checkout
              </Button>
              <Link to="/shop" className="block text-center text-xs text-muted-foreground hover:text-gold mt-4">Continue shopping</Link>
            </aside>
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default Cart;
