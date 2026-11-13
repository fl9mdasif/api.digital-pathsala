import { Plan } from './plan.model';

export const DEFAULT_PLANS = [
  {
    slug: 'free',
    name: 'ফ্রি',
    monthlyPrice: 0,
    yearlyPrice: 0,
    yearlyDiscount: 0,
    trialDays: 15,
    isActive: true,
    isPopular: false,
    features: [
      'শিক্ষার্থী সীমা: ৫০ জন',
      'শিক্ষক: ২ জন',
      'হাজিরা ব্যবস্থাপনা',
      'ফি ব্যবস্থাপনা',
      'পরীক্ষা ও রেজাল্ট',
      '১টি শাখা',
    ],
    notIncluded: [
      'নম্বরপত্র PDF',
      'নিজস্ব স্কুল ওয়েবসাইট',
      'CSV দিয়ে শিক্ষার্থী ইমপোর্ট',
      'মাল্টিপল ব্রাঞ্চ',
      'Priority Support',
    ],
  },
  {
    slug: 'basic',
    name: 'বেসিক',
    monthlyPrice: 699,
    yearlyPrice: 6999,
    yearlyDiscount: 1389,
    trialDays: 0,
    isActive: true,
    isPopular: false,
    features: [
      'শিক্ষার্থী সীমা: ৩০০ জন',
      'শিক্ষক: ১০ জন',
      'হাজিরা ব্যবস্থাপনা',
      'ফি কালেকশন ও PDF রিসিট',
      'পরীক্ষা ও রেজাল্ট',
      'নম্বরপত্র PDF',
      'নিজস্ব স্কুল ওয়েবসাইট',
      '১টি শাখা',
      'Email Support',
    ],
    notIncluded: [
      'CSV দিয়ে শিক্ষার্থী ইমপোর্ট',
      'মাল্টিপল ব্রাঞ্চ',
      'Priority Support',
      'Advanced Reports',
    ],
  },
  {
    slug: 'pro',
    name: 'প্রো',
    monthlyPrice: 1499,
    yearlyPrice: 14999,
    yearlyDiscount: 2989,
    trialDays: 0,
    isActive: true,
    isPopular: true,
    features: [
      'শিক্ষার্থী সীমা: সীমাহীন',
      'শিক্ষক: সীমাহীন',
      'হাজিরা ব্যবস্থাপনা',
      'ফি কালেকশন ও PDF রিসিট',
      'পরীক্ষা ও রেজাল্ট',
      'নম্বরপত্র PDF',
      'নিজস্ব স্কুল ওয়েবসাইট',
      'CSV দিয়ে শিক্ষার্থী ইমপোর্ট',
      'মাল্টিপল ব্রাঞ্চ',
      'Advanced Reports',
      'Priority Support',
    ],
    notIncluded: [],
  },
];

export const seedPlans = async () => {
  // drop legacy indexes that no longer match the new schema
  const col = Plan.collection;
  const indexes = await col.indexes().catch((e: { code?: number }) => {
    if (e?.code === 26) return []; // NamespaceNotFound: collection not created yet
    throw e;
  });
  for (const idx of indexes) {
    const key = Object.keys(idx.key)[0];
    if (key !== '_id') await col.dropIndex(idx.name as string).catch(() => null);
  }
  await Plan.deleteMany({});
  await Plan.insertMany(DEFAULT_PLANS);
  return Plan.find({ isActive: true }).sort({ monthlyPrice: 1 });
};
