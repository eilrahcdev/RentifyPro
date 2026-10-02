import { useEffect, useId, useRef, useState } from "react";
import "./VehicleTypeCarousel.css";

const DRAG_START_DISTANCE = 12;
const SWIPE_DISTANCE = 44;
const HORIZONTAL_GESTURE_RATIO = 1.2;
const BACKGROUND_WORDS = ["Explore", "Choose", "Rent", "Drive", "Travel", "Discover"];

export default function VehicleTypeCarousel({ categories, activeCategoryId, onSelect, onBrowse }) {
  const carouselId = useId();
  const carouselRef = useRef(null);
  const cursorHintRef = useRef(null);
  const cardRefs = useRef(new Map());
  const gestureRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isInView, setIsInView] = useState(true);
  const activeIndex = Math.max(0, categories.findIndex(({ id }) => id === activeCategoryId));
  const activeCategory = categories[activeIndex];

  const hideCursorHint = () => {
    if (cursorHintRef.current) cursorHintRef.current.hidden = true;
  };

  useEffect(() => {
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
    );
    if (carouselRef.current) observer?.observe(carouselRef.current);
    window.addEventListener("scroll", hideCursorHint, true);
    window.addEventListener("blur", hideCursorHint);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", hideCursorHint, true);
      window.removeEventListener("blur", hideCursorHint);
    };
  }, []);

  const updateCursorHint = (event) => {
    const hint = cursorHintRef.current;
    const card = event.target.closest("[data-category-card]");
    const dragging = gestureRef.current?.dragging;
    const isTouchDrag = event.pointerType === "touch" && dragging;
    if (!hint || (event.pointerType !== "mouse" && !isTouchDrag) || (!card && !dragging)) {
      hideCursorHint();
      return;
    }
    if (dragging) hint.textContent = isTouchDrag ? "Swipe to switch" : "Drag to switch";
    else hint.textContent = card.getAttribute("aria-current") === "true" ? "Click to browse" : "Click to select";
    hint.dataset.touchDrag = isTouchDrag ? "true" : "false";
    hint.hidden = false;
    const bounds = event.currentTarget.getBoundingClientRect();
    // Place the hint above the pointer or finger, within the carousel bounds.
    const x = Math.max(8, Math.min(event.clientX - bounds.left - hint.offsetWidth / 2, bounds.width - hint.offsetWidth - 8));
    const y = Math.max(8, Math.min(event.clientY - bounds.top - hint.offsetHeight - 18, bounds.height - hint.offsetHeight - 8));
    hint.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const moveCategory = (direction, focusCard = false) => {
    if (categories.length < 2) return;
    const nextIndex = (activeIndex + direction + categories.length) % categories.length;
    const category = categories[nextIndex];
    onSelect(category);
    if (focusCard) cardRefs.current.get(category.id)?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event) => {
    hideCursorHint();
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveCategory(event.key === "ArrowLeft" ? -1 : 1, Boolean(event.target.closest("[data-category-card]")));
  };

  const handlePointerDown = (event) => {
    if (!event.isPrimary || event.button !== 0) {
      gestureRef.current = null;
      setDragOffset(0);
      return;
    }
    suppressClickRef.current = false;
    setDragOffset(0);
    gestureRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  };

  const handlePointerMove = (event) => {
    updateCursorHint(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const distanceX = Math.abs(event.clientX - gesture.x);
    const distanceY = Math.abs(event.clientY - gesture.y);
    if (!gesture.dragging && distanceY > DRAG_START_DISTANCE && distanceY > distanceX) {
      gestureRef.current = null;
      setDragOffset(0);
      return;
    }
    if (gesture.dragging || (distanceX > DRAG_START_DISTANCE && distanceX > distanceY * HORIZONTAL_GESTURE_RATIO)) {
      gesture.dragging = true;
      suppressClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      // Keep the card under the pointer without letting it leave the deck.
      setDragOffset(Math.max(-28, Math.min(28, (event.clientX - gesture.x) * 0.35)));
      updateCursorHint(event);
    }
  };

  const handlePointerUp = (event) => {
    hideCursorHint();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setDragOffset(0);
    if (!gesture || gesture.id !== event.pointerId || !gesture.dragging) return;
    const distanceX = event.clientX - gesture.x;
    const distanceY = event.clientY - gesture.y;
    if (Math.abs(distanceX) >= SWIPE_DISTANCE && Math.abs(distanceX) > Math.abs(distanceY) * HORIZONTAL_GESTURE_RATIO) {
      moveCategory(distanceX < 0 ? 1 : -1);
    }
  };

  if (!activeCategory) return null;

  return (
    <div
      ref={carouselRef}
      className="rp-type-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Browse by vehicle type"
      aria-describedby={`${carouselId}-hint`}
      onKeyDown={handleKeyDown}
    >
      <div className="rp-type-carousel__stage">
        <div
          id={`${carouselId}-cards`}
          className="rp-type-carousel__viewport"
          data-dragging={dragOffset !== 0 || undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerEnter={updateCursorHint}
          onPointerLeave={hideCursorHint}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { gestureRef.current = null; setDragOffset(0); hideCursorHint(); }}
          onLostPointerCapture={(event) => {
            // Touch capture moves from the pressed card to this viewport during a swipe.
            if (event.target === event.currentTarget) { gestureRef.current = null; setDragOffset(0); }
          }}
          onClickCapture={(event) => {
            // A completed drag must never also activate the card beneath it.
            if (suppressClickRef.current && event.detail !== 0) {
              event.preventDefault();
              event.stopPropagation();
              suppressClickRef.current = false;
            }
          }}
        >
          <div className="rp-type-carousel__backdrop" aria-hidden="true">
            <div className="rp-type-carousel__words" data-paused={!isInView || undefined}>
              {[0, 1].map((copy) => (
                <span className="rp-type-carousel__word-group" key={copy}>
                  {BACKGROUND_WORDS.map((word) => <span key={word}>{word}<span className="rp-type-carousel__word-dot">•</span></span>)}
                </span>
              ))}
            </div>
          </div>
          {categories.map((category, index) => {
            const offset = (index - activeIndex + categories.length) % categories.length;
            const position = offset === 0 ? "active" : offset === 1 ? "next" : offset === categories.length - 1 ? "previous" : "back";
            const isActive = position === "active";
            const isHidden = position === "back";
            const CategoryIcon = category.icon;

            return (
              <div
                key={category.id}
                className="rp-type-carousel__card"
                data-position={position}
                style={isActive ? { "--rp-type-drag": `${dragOffset}px`, "--rp-type-drag-tilt": `${dragOffset / 14}deg` } : undefined}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${categories.length}`}
                aria-hidden={isHidden || undefined}
                inert={isHidden}
              >
                <button
                  ref={(node) => {
                    if (node) cardRefs.current.set(category.id, node);
                    else cardRefs.current.delete(category.id);
                  }}
                  type="button"
                  className="rp-type-carousel__card-button"
                  data-category-card={category.id}
                  tabIndex={isActive ? 0 : -1}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${isActive ? "Browse available" : "Select"} ${category.title.toLowerCase()}`}
                  onClick={() => {
                    if (isActive) onBrowse(category.vehicleType);
                    else onSelect(category);
                  }}
                >
                  <span className="rp-type-carousel__media">
                    <img src={category.image} alt="" loading="lazy" draggable="false" />
                    <span className="rp-type-carousel__number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")} / {String(categories.length).padStart(2, "0")}
                    </span>
                  </span>
                  <span className="rp-type-carousel__details">
                    <span className="rp-type-carousel__title-row">
                      <CategoryIcon size={22} strokeWidth={1.8} aria-hidden="true" />
                      <span className="rp-type-carousel__title">{category.title}</span>
                    </span>
                    {category.description && <span className="rp-type-carousel__description">{category.description}</span>}
                    <span className="rp-type-carousel__cta">
                      <span>Browse available {category.title.toLowerCase()}</span>
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
          <span ref={cursorHintRef} className="rp-type-carousel__cursor-hint" aria-hidden="true" hidden />
        </div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {activeCategory.title}, vehicle type {activeIndex + 1} of {categories.length}
        </p>
      </div>

      <p id={`${carouselId}-hint`} className="sr-only">Drag, swipe, select a card behind the center, or use Left and Right Arrow keys to select a type. Activate the center card to browse.</p>
    </div>
  );
}
