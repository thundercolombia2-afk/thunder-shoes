/**
 * Raíz de la app. Orden de proveedores:
 *   SessionProvider  → sesión y rol (lo usa AuthGate)
 *   AuthGate         → decide login / splash / app según la sesión
 *   Scan providers   → estado efímero del flujo de escaneo
 *   CartProvider     → carrito de la venta en curso
 *   Router           → pantallas
 * La selección de local va suelta en "/"; el resto vive en el armazón.
 */

import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { AuthGate } from '@/app/AuthGate'
import { ScanFlowProvider, ScanOverlayProvider } from '@/app/scanFlow'
import { CartProvider } from '@/app/cart'
import { AppShell } from '@/app/AppShell'
import { StoreSelectScreen } from '@/screens/StoreSelectScreen'
import { ScanScreen } from '@/screens/ScanScreen'
import { ScanResultScreen } from '@/screens/ScanResultScreen'
import { BuyScreen } from '@/screens/BuyScreen'
import { SellScreen } from '@/screens/SellScreen'
import { ConfirmScreen } from '@/screens/ConfirmScreen'
import { InventoryScreen } from '@/screens/InventoryScreen'
import { LocalesScreen } from '@/screens/LocalesScreen'
import { AddStockScreen } from '@/screens/AddStockScreen'
import { NewReferenceScreen } from '@/screens/NewReferenceScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { DashboardScreen } from '@/screens/DashboardScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { ProfileScreen } from '@/screens/ProfileScreen'

export function App() {
  return (
    <SessionProvider>
      <AuthGate>
        <ScanOverlayProvider>
          <ScanFlowProvider>
            <CartProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<StoreSelectScreen />} />
                  <Route element={<AppShell />}>
                    <Route path="/scan" element={<ScanScreen />} />
                    <Route path="/scan/result" element={<ScanResultScreen />} />
                    <Route path="/scan/buy" element={<BuyScreen />} />
                    <Route path="/scan/sell" element={<SellScreen />} />
                    <Route path="/scan/confirm" element={<ConfirmScreen />} />
                    <Route path="/inventory" element={<InventoryScreen />} />
                    <Route path="/locales" element={<LocalesScreen />} />
                    <Route path="/inventory/add" element={<AddStockScreen />} />
                    <Route path="/inventory/new" element={<NewReferenceScreen />} />
                    <Route path="/history" element={<HistoryScreen />} />
                    <Route path="/dashboard" element={<DashboardScreen />} />
                    <Route path="/settings" element={<SettingsScreen />} />
                    <Route path="/profile" element={<ProfileScreen />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </CartProvider>
          </ScanFlowProvider>
        </ScanOverlayProvider>
      </AuthGate>
    </SessionProvider>
  )
}
