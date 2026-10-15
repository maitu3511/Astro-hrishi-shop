import PageLayout from "@/components/PageLayout";
import SEO from "@/components/SEO";
import ServicesSection from "@/components/ServicesSection";
import TrustSection from "@/components/TrustSection";
import MoneyBackGuaranteeSection from "@/components/MoneyBackGuaranteeSection";

const Services = () => (
  <PageLayout title="Our Sacred Services" subtitle="Personalised Vedic guidance for every dimension of your life.">
    <SEO
      title="Vedic Astrology & Numerology Services | Astro With Hrishi"
      description="Book expert Kundli analysis, life path numerology, startup & business consultancy, and energised gemstone guidance with Astrologer Hrishi."
      path="/services"
      jsonLd={[
        {
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Vedic Astrology & Kundli Analysis",
          serviceType: "Astrological Consultation",
          provider: {
            "@type": "LocalBusiness",
            name: "Astro With Hrishi",
            url: "https://astrowithhrishi.com",
          },
          description: "In-depth birth chart analysis revealing planetary influences, life blueprint, and personalized remedial guidance.",
          areaServed: {
            "@type": "Country",
            name: "India",
          },
        },
        {
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Numerology & Mobile Number Alignment",
          serviceType: "Numerology Consultation",
          provider: {
            "@type": "LocalBusiness",
            name: "Astro With Hrishi",
            url: "https://astrowithhrishi.com",
          },
          description: "Life path number, lucky numbers, name correction and mobile number numerology analysis.",
        },
        {
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Startup & Business Astrology Consultancy",
          serviceType: "Business Consultation",
          provider: {
            "@type": "LocalBusiness",
            name: "Astro With Hrishi",
            url: "https://astrowithhrishi.com",
          },
          description: "End-to-end astrological guidance for startups, business naming, auspicious launch dates, and growth strategy.",
        },
      ]}
    />
    <ServicesSection />
    <MoneyBackGuaranteeSection />
    <TrustSection />
  </PageLayout>
);

export default Services;
