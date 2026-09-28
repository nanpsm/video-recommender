'use client'
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface SwipeableCardStackProps {
  images: string[]
  borderRadius?: number
  showInnerShadows?: boolean
  greenShadowColor?: string
  redShadowColor?: string
  innerStrokeColor?: string
  shadowSize?: string
  shadowBlur?: string
  rightIcon?: React.ReactNode | null
  leftIcon?: React.ReactNode | null
  onSwipeRight?: (originalIndex: number) => void
  onSwipeLeft?: (originalIndex: number) => void
  onSkip?: (originalIndex: number) => void
  renderOverlay?: (originalIndex: number, isTop: boolean) => React.ReactNode
}

export interface SwipeableCardStackHandle {
  swipeLeft: () => void
  swipeRight: () => void
  skip: () => void
}

interface CardItem {
  img: string
  originalIndex: number
}

export const SwipeableCardStack = React.forwardRef<SwipeableCardStackHandle, SwipeableCardStackProps>(function SwipeableCardStack({
  images = [],
  borderRadius = 16,
  showInnerShadows = true,
  greenShadowColor = 'rgba(45, 150, 45, 0.75)',
  redShadowColor = 'rgba(224, 83, 83, 0.75)',
  innerStrokeColor = 'rgba(0, 0, 0, 0.1)',
  shadowSize = '0 8px 20px',
  shadowBlur = 'rgba(0, 0, 0, 0.3)',
  rightIcon = null,
  leftIcon = null,
  onSwipeRight,
  onSwipeLeft,
  onSkip,
  renderOverlay,
}: SwipeableCardStackProps, ref) {
  // Store cards with original indices; reverse so first image is on top
  const [cards, setCards] = React.useState<CardItem[]>(() =>
    [...images].map((img, i) => ({ img, originalIndex: i })).reverse()
  )
  const [dragDirections, setDragDirections] = React.useState<Record<number, string | null>>({})

  // Sync poster URLs into existing cards without resetting the stack order
  React.useEffect(() => {
    setCards(prev => prev.map(card => ({
      ...card,
      img: images[card.originalIndex] ?? card.img,
    })))
  }, [images])

  const swipeThreshold = 80

  const handleDrag = (_event: unknown, info: { offset: { x: number } }, index: number) => {
    setDragDirections(prev => ({ ...prev, [index]: info.offset.x > 0 ? 'right' : 'left' }))
  }

  const handleDragEnd = (_event: unknown, info: { offset: { x: number } }, index: number) => {
    if (Math.abs(info.offset.x) > swipeThreshold) {
      handleSwipe(index, dragDirections[index] ?? 'left')
    } else {
      setDragDirections(prev => ({ ...prev, [index]: null }))
    }
  }

  const handleSwipe = (index: number, direction: string) => {
    const card = cards[index]
    setDragDirections(prev => ({ ...prev, [index]: direction }))
    setTimeout(() => {
      if (direction === 'right') onSwipeRight?.(card.originalIndex)
      else if (direction === 'skip') onSkip?.(card.originalIndex)
      else onSwipeLeft?.(card.originalIndex)
      setCards(prev => prev.filter((_, i) => i !== index))
    }, 300)
  }

  // Expose swipeLeft/swipeRight/skip so parent buttons can trigger card removal
  React.useImperativeHandle(ref, () => ({
    swipeLeft: () => {
      const topIndex = cards.length - 1
      if (topIndex >= 0) handleSwipe(topIndex, 'left')
    },
    swipeRight: () => {
      const topIndex = cards.length - 1
      if (topIndex >= 0) handleSwipe(topIndex, 'right')
    },
    skip: () => {
      const topIndex = cards.length - 1
      if (topIndex >= 0) handleSwipe(topIndex, 'skip')
    },
  }), [cards])

  // Only render the top 3 cards to keep the stack neat
  const visibleCards = cards.slice(-3)

  // Fixed offsets for the 2nd and 3rd cards
  const stackOffsets = [
    { scale: 0.92, y: 16, opacity: 0.6 },  // bottom (3rd)
    { scale: 0.96, y: 8,  opacity: 0.8 },  // middle (2nd)
    { scale: 1,    y: 0,  opacity: 1   },  // top (1st)
  ]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <AnimatePresence>
        {visibleCards.map((card, visibleIndex) => {
          const globalIndex = cards.indexOf(card)
          const isTopCard = visibleIndex === visibleCards.length - 1
          const direction = dragDirections[globalIndex]
          const offset = stackOffsets[stackOffsets.length - (visibleCards.length - visibleIndex)] ?? stackOffsets[0]
          return (
            <motion.div
              key={`${card.img}-${card.originalIndex}`}
              drag={isTopCard ? 'x' : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              onDrag={(e, i) => handleDrag(e, i, globalIndex)}
              onDragEnd={(e, i) => handleDragEnd(e, i, globalIndex)}
              custom={{ direction }}
              initial={{ scale: offset.scale, y: offset.y + 20, opacity: 0 }}
              animate={{
                scale: offset.scale,
                y: offset.y,
                opacity: offset.opacity,
                transition: { duration: 0.3, ease: 'easeOut' },
              }}
              exit="exit"
              variants={{
                exit: (custom: { direction?: string }) => {
                  if (custom?.direction === 'skip') return { y: -80, opacity: 0, scale: 0.88, transition: { duration: 0.28, ease: 'easeIn' } }
                  return {
                    x: (custom?.direction ?? 'left') === 'right' ? 400 : -400,
                    rotate: (custom?.direction ?? 'left') === 'right' ? 20 : -20,
                    opacity: 0,
                    transition: { duration: 0.35, ease: 'easeIn' },
                  }
                },
              }}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                background: card.img ? `url(${card.img}) center/cover` : '#1a1814',
                borderRadius,
                boxShadow: `inset 0 0 0 1px ${innerStrokeColor}, ${shadowSize} ${shadowBlur}`,
                cursor: isTopCard ? 'grab' : 'default',
                overflow: 'hidden',
              }}
            >
              {/* Dark overlay on background cards so they look like clean placeholders */}
              {!isTopCard && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,16,12,0.55)', borderRadius }} />
              )}

              {/* Inner shadow overlay for like/nope feedback */}
              {isTopCard && showInnerShadows && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius, pointerEvents: 'none',
                  boxShadow: direction === 'right'
                    ? `inset 0px -80px 60px ${greenShadowColor}`
                    : direction === 'left'
                    ? `inset 0px -80px 60px ${redShadowColor}`
                    : 'none',
                  transition: 'box-shadow 0.15s ease-out',
                }} />
              )}

              {/* LIKE / NOPE stamp */}
              {isTopCard && direction === 'right' && (
                <div style={{
                  position: 'absolute', top: 36, left: 20, zIndex: 10,
                  border: '4px solid #22C55E', borderRadius: 8, padding: '4px 14px',
                  transform: 'rotate(-15deg)',
                }}>
                  <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 30, color: '#22C55E', letterSpacing: '0.05em' }}>LIKE</span>
                </div>
              )}
              {isTopCard && direction === 'left' && (
                <div style={{
                  position: 'absolute', top: 36, right: 20, zIndex: 10,
                  border: '4px solid #ef4444', borderRadius: 8, padding: '4px 14px',
                  transform: 'rotate(15deg)',
                }}>
                  <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 30, color: '#ef4444', letterSpacing: '0.05em' }}>DISLIKE</span>
                </div>
              )}

              {/* Per-card overlay content (title, genre chips, etc.) */}
              {renderOverlay?.(card.originalIndex, isTopCard)}

              {/* Icon overlay */}
              {isTopCard && direction && (rightIcon || leftIcon) && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                  {direction === 'right' ? rightIcon : leftIcon}
                </div>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
})
