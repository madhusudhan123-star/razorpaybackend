# What is this ? 



This repo will help to integrated shiprocket with React / React native / Node js  



# Installation

`yarn add shiprocket-api`  or  `npm i shiprocket-api --save`


Then... 

```
import { GetToken, CourierServiceability , Tracking_OrderId } from 'shiprocket-api'


///  Get Token
const token = await GetToken({
      email : 'example@email.com',
      password: 'password',
    })

///  Check Courier Serviceability
    const response = await CourierServiceability({

    auth: {
            email : 'example@email.com',
            password: 'password',
        },
    params: {
        pickup_postcode : 600000,
        delivery_postcode : 600005,
        weight: 2,
        cod : 1
    }
})
    
//// Get Tracking Data through Order ID
    const response = await Tracking_OrderId({
        auth: {
            email : 'example@email.com',
            password: 'password',
        },
        params: {
            order_id : '55097',
        }
    })
```


# Options

shiprocket supports 2 options , both of which are required 



auth option: 
* *email*  _(required if you don't provide direct token)_
* *password* _(required if you don't provide direct token)_
* *token* _(Bearer token for authentication)_ 

params option: 
* *necessary parameters  *  _(you can find the parameters list in their offical documentation)_



# Docs

Offcial APi docs : [Shiprocket API] (https://apidocs.shiprocket.in/)


# Support 

if you have any questions or suggestions or feature request then email me.

support email : solaiman321@gmail.com