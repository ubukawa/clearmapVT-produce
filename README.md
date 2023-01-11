# clearmapVT-produce
Producing clearmap vector tile using nodejs and tippecanoe


# Usage
Confirm that you can use tippecanoe (2.17 or later version) and nodejs.
Then, edit config/default.hjson to update your parameters.

```
git clone https://github.com/ubukawa/clearmapVT-produce
cd clearmapVT-produce
npm install
node index.js
```

If you use docker

```
git clone https://github.com/ubukawa/clearmapVT-produce
cd clearmapVT-produce
docker run -it --rm -v ${PWD}:/data unvt/nanban
cd /data
npm install
node index.js
```