const header = document.querySelector("[data-header]");
const reveals = document.querySelectorAll(".reveal");
const form = document.querySelector("#contact-form");

document.querySelector("#year").textContent = new Date().getFullYear();

window.addEventListener("scroll", () => {
  header.classList.toggle("scrolled", window.scrollY > 16);
}, { passive: true });

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

reveals.forEach((element) => observer.observe(element));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const firstName = String(data.get("firstName") || "").trim();
  const lastName = String(data.get("lastName") || "").trim();
  const email = String(data.get("email") || "").trim();
  const message = String(data.get("message") || "").trim();
  const subject = encodeURIComponent(`PlannerBuild enquiry from ${firstName} ${lastName}`);
  const body = encodeURIComponent(`Name: ${firstName} ${lastName}\nEmail: ${email}\n\nProject details:\n${message}`);
  window.location.href = `mailto:info@plannerbuild.com?subject=${subject}&body=${body}`;
});
