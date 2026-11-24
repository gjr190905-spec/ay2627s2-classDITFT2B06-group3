self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let body = 'Open your orders to check your pickup update.';
    let url = '/#orders';
    try {
      const res = await fetch('/api/pickup/ready',{credentials:'include',cache:'no-store'});
      if (res.ok) {
        const {orders} = await res.json();
        if (orders.length === 1) {
          body = 'Order ' + orders[0].order_number + ' is ready. Collect it from ' + orders[0].stall + '.';
          url = '/#order/' + orders[0].id;
        } else if (orders.length > 1) body = orders.length + ' orders are ready for collection.';
      }
    } catch { /* A generic preview is available during a temporary connection loss. */ }
    await self.registration.showNotification('Makan Liao · Pickup update',{body,icon:'/icon192.png',tag:'makan-pickup',data:{url}});
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/#orders'));
});
