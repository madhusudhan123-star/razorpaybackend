const axios = require("axios").default;
const Utils = require("./utils");

///  Get Token
async function GetToken({ email, password }) {
  const token = await Utils.GetToken(email, password);
  return token;
}

//// Get Tracking Data through Order ID
async function Tracking_OrderId({ auth, params }) {
  if (!auth.email && !auth.password && !auth.token) {
    return console.log("pass the valid props");
  }

  if (!params) {
    return console.log("order_id params is required");
  }

  var token = auth.token;
  if (!token) {
    token = await Utils.GetToken(auth.email, auth.password);
  }

  const parameterGenerator = new URLSearchParams(params);
  const parameter = parameterGenerator.toString();

  const url = `https://apiv2.shiprocket.in/v1/external/courier/track?${parameter}`;

  const myHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const requestOptions = {
    url,
    method: "GET",
    headers: myHeaders,
    redirect: "follow",
  };

  try {
    const response = await axios(requestOptions);
    const trackingDetails = await response.data;
    return trackingDetails;
  } catch (err) {
    console.log(err);
    const status  = err.response.status
    return status
  }
}





///  Check Courier Serviceability
async function CourierServiceability({ auth, params }) {
  if (!auth.email && !auth.password && !auth.token) {
    return console.log("pass the valid props");
  }

  var token = auth.token;
  if (!token) {
    token = await Utils.GetToken(auth.email, auth.password);
  }

  const parameterGenerator = new URLSearchParams(params);
  const parameter = parameterGenerator.toString();
  const url = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${parameter}`;

  const myHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const requestOptions = {
    url,
    method: "GET",
    headers: myHeaders,
    redirect: "follow",
  };

  try {
    const response = await axios(requestOptions);
    if (response.data.status == "422") {
      const errorMessage = "Invalid Pincode";
      return errorMessage;
    }
    if (response.data.status == "404") {
      const errorMessage = response.data.message;
      return errorMessage;
    }
    
    const json = response.data;
    const estimatedDate = json.data.available_courier_companies[0].etd;
    return estimatedDate;
  } catch (err) {
    console.log(err);
    const status  = err.response.status
    return status
  }
}

module.exports = { Tracking_OrderId, CourierServiceability, GetToken };
