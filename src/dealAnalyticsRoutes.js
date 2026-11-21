import { requireTenantScope } from './tenantScope.js';
import { analyticsRange, configureDealHours, exportDealAnalytics, recordAnalyticsOutcome, tenantDealAnalytics } from './dealAnalytics.js';

const respond = action => (req,res,next) => {
  res.setHeader('Cache-Control','private, no-store');
  try { action(req,res); }
  catch (err) {
    if (!err.status) return next(err);
    res.status(err.status).json({error:err.message});
  }
};

export function mountDealAnalytics(api) {
  api.get('/deals/analytics',requireTenantScope,respond((req,res)=>{
    res.json(tenantDealAnalytics(req.tenantScope,analyticsRange(req.query)));
  }));
  api.get('/deals/analytics/export',requireTenantScope,respond((req,res)=>{
    const csv=exportDealAnalytics(req.tenantScope,analyticsRange(req.query,Date.now(),true));
    res.attachment('deal-analytics.csv').type('text/csv; charset=utf-8').send('\ufeff'+csv);
  }));
  api.patch('/deals/analytics/hours',requireTenantScope,respond((req,res)=>{
    res.json(configureDealHours(req.tenantScope,req.body));
  }));
  api.post('/deals/:id/analytics-outcome',requireTenantScope,respond((req,res)=>{
    res.json(recordAnalyticsOutcome.immediate(req.tenantScope,Number(req.params.id),req.body));
  }));
}
