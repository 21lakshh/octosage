"use client"

import { motion, useInView } from "framer-motion"
import { useRef, useEffect, useState } from "react"
import { Activity, Command, BarChart3, Zap, Shield } from "lucide-react"

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  },
}

const metricValues = {
  CPU: "94%",
  Memory: "81%",
  Network: "72%",
  Storage: "88%",
} as const

const metrics = ["CPU", "Memory", "Network", "Storage"] as const

function SystemStatus() {
  const [dots, setDots] = useState([true, true, true, false, true])

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => prev.map(() => Math.random() > 0.2))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2">
      {dots.map((active, i) => (
        <motion.div
          key={i}
          className={`w-2 h-2 rounded-full ${active ? "bg-emerald-500" : "bg-zinc-700"}`}
          animate={active ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

function KeyboardCommand() {
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setPressed(true)
      setTimeout(() => setPressed(false), 200)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-1">
      <motion.kbd
        animate={pressed ? { scale: 0.95, y: 2 } : { scale: 1, y: 0 }}
        className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 font-mono"
      >
        ⌘
      </motion.kbd>
      <motion.kbd
        animate={pressed ? { scale: 0.95, y: 2 } : { scale: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 font-mono"
      >
        K
      </motion.kbd>
    </div>
  )
}

function AnimatedChart() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true })

  const points = [
    { x: 0, y: 60 },
    { x: 20, y: 45 },
    { x: 40, y: 55 },
    { x: 60, y: 30 },
    { x: 80, y: 40 },
    { x: 100, y: 15 },
  ]

  const pathD = points.reduce((acc, point, i) => {
    return i === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`
  }, "")

  return (
    <svg ref={ref} viewBox="0 0 100 70" className="w-full h-24">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(255,255,255)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="rgb(255,255,255)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {isInView && (
        <>
          <path d={`${pathD} L 100 70 L 0 70 Z`} fill="url(#chartGradient)" className="opacity-50" />
          <path d={pathD} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" className="draw-line" />
        </>
      )}
    </svg>
  )
}

export function BentoGrid() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section id="features" className="py-24 px-4 bg-[#050505] relative z-20">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground mb-4 uppercase">Analytics</p>
          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-light tracking-tight text-white mb-4"
          >
            Always-current ownership <span className="italic font-serif">intelligence</span>
          </h2>
          <p className="font-mono text-sm tracking-wider text-zinc-400 max-w-2xl mx-auto uppercase">
            OctoSage combines GitHub history, recency scoring, and a visual repo graph.
          </p>
        </motion.div>

        <motion.div
          ref={ref}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {/* Large card - System Status */}
          <motion.div
            data-cursor-hover
            variants={itemVariants}
            className="md:col-span-2 group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300 overflow-hidden"
          >
            <div className="flex items-start justify-between mb-8">
              <div>
                <div className="p-2 rounded-lg bg-zinc-800 w-fit mb-4">
                  <Activity className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Target PR reviews</h3>
                <p className="text-zinc-400 text-sm">
                  Find the developer who has been shaping the code that changed most recently, not the teammate who once touched it a year ago.
                </p>
              </div>
              <SystemStatus />
            </div>
            <div className="grid grid-cols-4 gap-4">
              {metrics.map((metric) => (
                <div key={metric} className="text-center">
                  <div className="text-2xl font-bold text-white mb-1">{metricValues[metric]}</div>
                  <div className="text-xs text-zinc-500">{metric}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Command Palette */}
          <motion.div
            variants={itemVariants}
            data-cursor-hover
            className="group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="p-2 rounded-lg bg-zinc-800 w-fit mb-4">
              <Command className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Expose bus-factor risk</h3>
            <p className="text-zinc-400 text-sm mb-6">Surface fragile modules that hinge on one person so teams can spread ownership.</p>
            <KeyboardCommand />
          </motion.div>

          {/* Analytics */}
          <motion.div
            variants={itemVariants}
            data-cursor-hover
            className="group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="p-2 rounded-lg bg-zinc-800 w-fit mb-4">
              <BarChart3 className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Onboard with context</h3>
            <p className="text-zinc-400 text-sm mb-4">Give new engineers a live map of domain experts across the repo without asking anyone to keep stale docs in sync.</p>
            <AnimatedChart />
          </motion.div>

          {/* Performance */}
          <motion.div
            variants={itemVariants}
            data-cursor-hover
            className="group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="p-2 rounded-lg bg-zinc-800 w-fit mb-4">
              <Zap className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">GitHub History</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Syncs directly with your repositories to provide accurate, historical data.
            </p>
            <div className="flex items-center gap-2 text-[#58a6ff] text-sm">
              <span className="font-mono">Real-time</span>
              <span className="text-zinc-500">synchronization</span>
            </div>
          </motion.div>

          {/* Security */}
          <motion.div
            variants={itemVariants}
            data-cursor-hover
            className="group relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 hover:scale-[1.02] transition-all duration-300"
          >
            <div className="p-2 rounded-lg bg-zinc-800 w-fit mb-4">
              <Shield className="w-5 h-5 text-zinc-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Recency-weighted Scoring</h3>
            <p className="text-zinc-400 text-sm mb-4">Prioritizes recent contributions over older ones to find the true current owner.</p>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 text-xs bg-zinc-800 rounded text-zinc-400">History</span>
              <span className="px-2 py-1 text-xs bg-zinc-800 rounded text-zinc-400">Lines</span>
              <span className="px-2 py-1 text-xs bg-zinc-800 rounded text-zinc-400">Recency</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
