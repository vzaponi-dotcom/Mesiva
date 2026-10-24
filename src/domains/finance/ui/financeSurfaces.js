import React from 'react'

const load = (path) => {
  const modules = import.meta.glob(['./FinanceWorkspace.jsx', './Receivables.jsx', './DayConference.jsx'], { eager: true })
  return modules[path]?.default
}

export function FinanceWorkspace(props) {
  const Component = load('./FinanceWorkspace.jsx')
  return React.createElement(Component, props)
}

export function Receivables(props) {
  const Component = load('./Receivables.jsx')
  return React.createElement(Component, props)
}

export function DayConference(props) {
  const Component = load('./DayConference.jsx')
  return React.createElement(Component, props)
}
