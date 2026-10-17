import React from 'react'

const loadOrders = () => {
  const modules = import.meta.glob('./Orders.jsx', { eager: true })
  return modules['./Orders.jsx']?.default
}

const loadOrderHistory = () => {
  const modules = import.meta.glob('./OrderHistory.jsx', { eager: true })
  return modules['./OrderHistory.jsx']?.default
}

const loadOrderDetail = () => {
  const modules = import.meta.glob('./components/OrderDetail.jsx', { eager: true })
  return modules['./components/OrderDetail.jsx']?.default
}

export function Orders(props) {
  const Component = loadOrders()
  return React.createElement(Component, props)
}

export function OrderHistory(props) {
  const Component = loadOrderHistory()
  return React.createElement(Component, props)
}

export function OrderDetail(props) {
  const Component = loadOrderDetail()
  return React.createElement(Component, props)
}

const loadOrderEditChanges = () => {
  const modules = import.meta.glob('./components/OrderEditChanges.jsx', { eager: true })
  return modules['./components/OrderEditChanges.jsx']?.default
}

export function OrderEditChanges(props) {
  const Component = loadOrderEditChanges()
  return React.createElement(Component, props)
}
