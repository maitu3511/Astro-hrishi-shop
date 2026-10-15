import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import BookingSection from "@/components/BookingSection";

const Booking = () => (
  <PageLayout title="Book Your Appointment" subtitle="Reserve a sacred slot with Hrishi. We confirm instantly on WhatsApp.">
    <SEO
      title="Book Astrology Appointment | Astro With Hrishi"
      description="Book a 1-on-1 personalized Vedic astrology consultation with Astrologer Hrishi. Instant booking confirmation on WhatsApp."
      path="/booking"
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "ReserveAction",
        target: "https://astrowithhrishi.com/booking",
        agent: {
          "@type": "Person",
          name: "Astrologer Hrishi",
        },
        result: {
          "@type": "Reservation",
          name: "Vedic Astrology Consultation Appointment",
          provider: {
            "@type": "LocalBusiness",
            name: "Astro With Hrishi",
          },
        },
      }}
    />
    <BookingSection />
  </PageLayout>
);

export default Booking;
