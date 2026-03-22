export const todayISO = () => new Date().toISOString().split('T')[0]

export const emptyTrip = () => ({
  date: todayISO(),
  vehicle_no: '',
  vehicle_size: '',
  driver_name: '',
  origin: '',
  destination: '',
  client_id: '',
  amount: '',
  remarks: '',
})
