const spring = { type: 'spring', stiffness: 300, damping: 26 } as const

export function useAuthMotion() {
  const card = {
    initial: { opacity: 0, y: 24, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { type: 'spring', stiffness: 260, damping: 24 }
  } as const

  function item(index: number) {
    return {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      transition: { ...spring, delay: 0.12 + index * 0.07 }
    }
  }

  return { card, item }
}
