import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

export async function seedDatabase() {
  try {
    // Check if already seeded
    const companyRef = doc(db, 'config', 'company_info')
    const companySnap = await getDoc(companyRef)
    if (companySnap.exists()) {
      return false // Already seeded
    }

    // Try to seed — will fail silently if user doesn't have write access to config
    await setDoc(companyRef, {
      name: 'ON TIME DELIVERIES',
      address: 'Flat No - 3/1, Mittal Residency, Near Carmel School, Sonari, Jamshedpur, East Singhbhum, Jharkhand-831011',
      gstin: '20HMBPS6520P1ZQ',
      pan: 'HMBPS6520P',
      state: 'Jharkhand',
      state_code: '20',
      phone: '9608186440',
      email: 'ontimedeliveries3@gmail.com',
      bank_name: 'State Bank of India',
      bank_branch: 'Sonari Branch, Jamshedpur, Jharkhand',
      bank_account: '42513324534',
      bank_ifsc: 'SBIN0006026',
    })

    await setDoc(doc(db, 'config', 'counters'), {
      current_fy: '25-26',
      last_seq: 57,
    })

    await setDoc(doc(db, 'clients', 'shadowfax'), {
      name: 'SHADOWFAX TECHNOLOGIES LTD.',
      address: '2H/8, H.I.G, Bahadurpur Housing Colony, Patna',
      state: 'Bihar',
      state_code: '10',
      gstin: '10AAVCS6697K1ZI',
      client_id_label: 'VENDOR CODE',
      client_id_value: 'SFV0346',
      quantity_label: 'No. of Trips',
      tax_rate: 0.18,
      default_hsn_sac: '996601',
      customer_section_style: 'standard',
    })

    await setDoc(doc(db, 'clients', 'meesho'), {
      name: 'Meesho Limited',
      address: '3rd Floor, Wing-E, Helios Business Park, Kadubeesanahalli Village, Varthur Hobli, Outer Ring Road, Bengaluru, Karnataka 560103',
      state: 'Karnataka',
      state_code: '29',
      gstin: '29AACCF6368D1ZI',
      client_id_label: 'ORACLE ID',
      client_id_value: '18699',
      quantity_label: 'KMS',
      tax_rate: 0.18,
      default_hsn_sac: '996601',
      customer_section_style: 'meesho',
    })

    console.log('Database seeded successfully!')
    return true
  } catch (err) {
    // Permission denied or other error — skip seeding silently
    console.warn('Seed skipped (may need super admin):', err.message)
    return false
  }
}
